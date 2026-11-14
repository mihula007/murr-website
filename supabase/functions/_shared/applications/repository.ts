import type { Executor } from '../db/client.ts'
import type { Database } from '../db/database.types.ts'

export type ApplicationRow =
  Database['app']['Tables']['join_applications']['Row']

/** Статусы, при которых заявка ещё рассматривается (Q-06: не более одной). */
export const ACTIVE_STATUSES = [
  'pending_officer_review',
  'pending_vote',
] as const

export const DECIDED_STATUSES = [
  'officer_approved',
  'officer_rejected',
  'admin_approved',
  'admin_rejected',
] as const

/** Уникальный частичный индекс активной заявки (миграция этапа 3). */
export const ONE_ACTIVE_CONSTRAINT = 'join_applications_one_active'

/** Ключ сортировки решённых заявок: время решения и `id`, по убыванию. */
export type DecidedKey = { decidedAt: string; id: string }

export type QueueOptions =
  | { order: 'oldest_submitted'; statuses: readonly string[]; limit: number }
  | {
      order: 'latest_decided'
      statuses: readonly string[]
      after: DecidedKey | null
      limit: number
    }

export const applicationRepository = {
  latestForApplicant(db: Executor, applicantId: string) {
    return db
      .selectFrom('app.join_applications')
      .select(['id', 'status', 'submitted_at'])
      .where('applicant_id', '=', applicantId)
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst()
  },

  async create(db: Executor, applicantId: string, links: string[]) {
    const application = await db
      .insertInto('app.join_applications')
      .values({ applicant_id: applicantId, status: 'pending_officer_review' })
      .returning('id')
      .executeTakeFirstOrThrow()
    if (links.length > 0) {
      await db
        .insertInto('app.application_equipment_links')
        .values(
          links.map((url, position) => ({
            application_id: application.id,
            url,
            position,
          })),
        )
        .execute()
    }
    return application.id
  },

  async hasActive(db: Executor, applicantId: string) {
    const row = await db
      .selectFrom('app.join_applications')
      .select('id')
      .where('applicant_id', '=', applicantId)
      .where('status', 'in', ACTIVE_STATUSES)
      .executeTakeFirst()
    return row !== undefined
  },

  async countByStatus(db: Executor, status: string) {
    const row = await db
      .selectFrom('app.join_applications')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('status', '=', status)
      .executeTakeFirstOrThrow()
    return Number(row.count)
  },

  /** Очередь с ником, классом и путём аватара кандидата. */
  listQueue(db: Executor, options: QueueOptions) {
    let query = db
      .selectFrom('app.join_applications as a')
      .innerJoin('app.profiles as p', 'p.id', 'a.applicant_id')
      .innerJoin('app.character_classes as c', 'c.id', 'p.class_id')
      .select([
        'a.id',
        'a.status',
        'a.submitted_at',
        'a.decided_at',
        'p.id as applicant_id',
        'p.game_nickname',
        'p.class_id',
        'c.name as class_name',
        'p.avatar_path',
      ])
      .where('a.status', 'in', options.statuses)
    if (options.order === 'oldest_submitted') {
      query = query.orderBy('a.submitted_at', 'asc').orderBy('a.id')
    } else {
      const { after } = options
      if (after) {
        // Keyset по убыванию: строки строго «раньше» последней показанной.
        query = query.where((eb) =>
          eb(
            eb.refTuple('a.decided_at', 'a.id'),
            '<',
            eb.tuple(after.decidedAt, after.id),
          ),
        )
      }
      query = query.orderBy('a.decided_at', 'desc').orderBy('a.id', 'desc')
    }
    return query.limit(options.limit).execute()
  },

  /** Заявка со всеми полями кандидата; набор для ответа выбирает сервис. */
  findDetails(db: Executor, id: string) {
    return db
      .selectFrom('app.join_applications as a')
      .innerJoin('app.profiles as p', 'p.id', 'a.applicant_id')
      .innerJoin('app.character_classes as c', 'c.id', 'p.class_id')
      .innerJoin('auth.users as u', 'u.id', 'p.id')
      .leftJoin('app.profiles as d', 'd.id', 'a.decided_by')
      .select([
        'a.id',
        'a.status',
        'a.submitted_at',
        'a.decided_at',
        'a.decision_note',
        'd.game_nickname as decided_by_nickname',
        'p.id as applicant_id',
        'p.display_name',
        'p.game_nickname',
        'p.class_id',
        'c.name as class_name',
        'p.avatar_path',
        'p.about',
        'p.city',
        'p.birth_date',
        'u.email',
      ])
      .where('a.id', '=', id)
      .executeTakeFirst()
  },

  async links(db: Executor, applicationId: string) {
    const rows = await db
      .selectFrom('app.application_equipment_links')
      .select('url')
      .where('application_id', '=', applicationId)
      .orderBy('position')
      .execute()
    return rows.map((row) => row.url)
  },

  async exists(db: Executor, id: string) {
    const row = await db
      .selectFrom('app.join_applications')
      .select('id')
      .where('id', '=', id)
      .executeTakeFirst()
    return row !== undefined
  },

  /**
   * Переход активной заявки `from` → `to` без решения (голосование, APP-05,
   * 07, 11). Условное обновление: другой статус — строка не меняется.
   */
  async transition(
    tx: Executor,
    id: string,
    from: string,
    to: string,
    at: string,
  ) {
    const row = await tx
      .updateTable('app.join_applications')
      .set({ status: to, updated_at: at })
      .where('id', '=', id)
      .where('status', '=', from)
      .returning('applicant_id')
      .executeTakeFirst()
    return row?.applicant_id
  },

  /**
   * Решение по заявке из статуса `from`. Условное обновление защищает от
   * параллельного решения: если статус уже другой, строка не меняется.
   */
  async decide(
    tx: Executor,
    id: string,
    from: string,
    values: {
      status: string
      decided_by: string
      decided_at: string
      decision_note: string | null
    },
  ) {
    const row = await tx
      .updateTable('app.join_applications')
      .set({ ...values, updated_at: values.decided_at })
      .where('id', '=', id)
      .where('status', '=', from)
      .returning('applicant_id')
      .executeTakeFirst()
    return row?.applicant_id
  },
}
