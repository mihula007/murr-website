import { sql } from 'kysely'
import type { EventAnswer, EventType } from '../contracts/events.ts'
import type { Executor } from '../db/client.ts'

/** Ключ блокировки создания шаблонов (лимит не обходится гонкой). */
const TEMPLATES_LOCK_KEY = 6_000_001

/** Ключ сортировки прошедших: время закрытия и `id`, по убыванию. */
export type ClosedKey = { closedAt: string; id: string }

export type EventListOptions =
  | { tab: 'active'; limit: number }
  | { tab: 'past'; after: ClosedKey | null; limit: number }

export type EventValues = {
  title: string
  eventType: EventType
  description: string
  startsAt: string
}

/** Событие с ником автора. */
function selectEvents(db: Executor) {
  return db
    .selectFrom('app.events as e')
    .leftJoin('app.profiles as author', 'author.id', 'e.created_by')
    .select([
      'e.id',
      'e.title',
      'e.event_type',
      'e.description',
      'e.starts_at',
      'e.recurring_preset',
      'e.created_by',
      'e.closed_at',
      'author.game_nickname as author_nickname',
    ])
}

export type EventRow = Awaited<
  ReturnType<ReturnType<typeof selectEvents>['executeTakeFirstOrThrow']>
>

export const eventRepository = {
  async create(
    tx: Executor,
    values: EventValues & { createdBy: string | null },
  ) {
    const row = await tx
      .insertInto('app.events')
      .values({
        title: values.title,
        event_type: values.eventType,
        description: values.description,
        starts_at: values.startsAt,
        created_by: values.createdBy,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
    return row.id
  },

  /**
   * Выпуск постоянного события; уже существующий (тот же пресет и время)
   * не создаётся (EVT-14). Возвращает id нового выпуска или null.
   */
  async createRecurring(
    tx: Executor,
    values: EventValues & { preset: string },
  ) {
    const row = await tx
      .insertInto('app.events')
      .values({
        title: values.title,
        event_type: values.eventType,
        description: values.description,
        starts_at: values.startsAt,
        recurring_preset: values.preset,
        created_by: null,
      })
      .onConflict((oc) =>
        oc.columns(['recurring_preset', 'starts_at']).doNothing(),
      )
      .returning('id')
      .executeTakeFirst()
    return row?.id ?? null
  },

  list(db: Executor, options: EventListOptions) {
    let query = selectEvents(db)
    if (options.tab === 'active') {
      query = query
        .where('e.closed_at', 'is', null)
        .orderBy('e.starts_at', 'asc')
        .orderBy('e.id', 'asc')
    } else {
      const { after } = options
      query = query.where('e.closed_at', 'is not', null)
      if (after) {
        query = query.where((eb) =>
          eb(
            eb.refTuple('e.closed_at', 'e.id'),
            '<',
            eb.tuple(after.closedAt, after.id),
          ),
        )
      }
      query = query.orderBy('e.closed_at', 'desc').orderBy('e.id', 'desc')
    }
    return query.limit(options.limit).execute()
  },

  find(db: Executor, id: string) {
    return selectEvents(db).where('e.id', '=', id).executeTakeFirst()
  },

  async counts(db: Executor) {
    const row = await db
      .selectFrom('app.events')
      .select((eb) => [
        eb.fn
          .count<string>('id')
          .filterWhere('closed_at', 'is', null)
          .as('active'),
        eb.fn
          .count<string>('id')
          .filterWhere('closed_at', 'is not', null)
          .as('past'),
      ])
      .executeTakeFirstOrThrow()
    return { active: Number(row.active), past: Number(row.past) }
  },

  /**
   * Строка события с блокировкой. `share` — для ответа: ответы не мешают
   * друг другу, но правка, удаление и закрытие ждут их и наоборот.
   */
  lock(tx: Executor, id: string, mode: 'share' | 'update') {
    const query = tx
      .selectFrom('app.events')
      .select([
        'id',
        'title',
        'event_type',
        'starts_at',
        'recurring_preset',
        'created_by',
        'closed_at',
      ])
      .where('id', '=', id)
    return (
      mode === 'share' ? query.forShare() : query.forUpdate()
    ).executeTakeFirst()
  },

  async update(tx: Executor, id: string, values: EventValues & { at: string }) {
    await tx
      .updateTable('app.events')
      .set({
        title: values.title,
        event_type: values.eventType,
        description: values.description,
        starts_at: values.startsAt,
        updated_at: values.at,
      })
      .where('id', '=', id)
      .execute()
  },

  /** Удаляет событие; ответы удаляются каскадом (EVT-10). */
  async delete(tx: Executor, id: string) {
    await tx.deleteFrom('app.events').where('id', '=', id).execute()
  },

  /** Счётчики ответов нескольких событий. */
  async answerCounts(db: Executor, eventIds: readonly string[]) {
    if (eventIds.length === 0) {
      return []
    }
    const rows = await db
      .selectFrom('app.event_attendance')
      .select((eb) => [
        'event_id',
        'answer',
        eb.fn.countAll<string>().as('count'),
      ])
      .where('event_id', 'in', eventIds)
      .groupBy(['event_id', 'answer'])
      .execute()
    return rows.map((row) => ({
      eventId: row.event_id,
      answer: row.answer as EventAnswer,
      count: Number(row.count),
    }))
  },

  /** Ответы пользователя в нескольких событиях: event_id → answer. */
  async answersOf(db: Executor, eventIds: readonly string[], userId: string) {
    if (eventIds.length === 0) {
      return new Map<string, EventAnswer>()
    }
    const rows = await db
      .selectFrom('app.event_attendance')
      .select(['event_id', 'answer'])
      .where('event_id', 'in', eventIds)
      .where('user_id', '=', userId)
      .execute()
    return new Map(rows.map((row) => [row.event_id, row.answer as EventAnswer]))
  },

  /** Создаёт или меняет ответ участника — одна строка (EVT-05). */
  async upsertAnswer(
    tx: Executor,
    value: { eventId: string; userId: string; answer: EventAnswer; at: string },
  ) {
    await tx
      .insertInto('app.event_attendance')
      .values({
        event_id: value.eventId,
        user_id: value.userId,
        answer: value.answer,
        answered_at: value.at,
      })
      .onConflict((oc) =>
        oc
          .columns(['event_id', 'user_id'])
          .doUpdateSet({ answer: value.answer, answered_at: value.at }),
      )
      .execute()
  },

  /**
   * Участники актуального события: текущий состав (внутренние роли), все
   * ответившие и стоящие в группах, включая ставших чтецами. Сначала
   * ответившие, затем по нику.
   */
  participants(
    db: Executor,
    eventId: string,
    roles: readonly string[],
    limit: number,
  ) {
    return db
      .selectFrom('app.profiles as p')
      .leftJoin('app.event_attendance as a', (join) =>
        join.onRef('a.user_id', '=', 'p.id').on('a.event_id', '=', eventId),
      )
      .innerJoin('app.character_classes as c', 'c.id', 'p.class_id')
      .select([
        'p.id',
        'p.game_nickname',
        'p.avatar_path',
        'p.class_id',
        'c.name as class_name',
        'a.answer',
      ])
      .where((eb) =>
        eb.or([
          eb('p.access_role', 'in', roles),
          eb('a.event_id', 'is not', null),
          eb.exists(
            eb
              .selectFrom('app.event_group_members as m')
              .select('m.user_id')
              .whereRef('m.user_id', '=', 'p.id')
              .where('m.event_id', '=', eventId),
          ),
        ]),
      )
      .orderBy((eb) => eb('a.answer', 'is', null), 'asc')
      .orderBy('p.game_nickname')
      .orderBy('p.id')
      .limit(limit)
      .execute()
  },

  templates(db: Executor, limit: number) {
    return db
      .selectFrom('app.event_templates as t')
      .leftJoin('app.profiles as author', 'author.id', 't.created_by')
      .select([
        't.id',
        't.title',
        't.event_type',
        't.description',
        't.weekday',
        't.time_msk',
        'author.game_nickname as author_nickname',
      ])
      .orderBy('t.created_at', 'desc')
      .orderBy('t.id', 'desc')
      .limit(limit)
      .execute()
  },

  findTemplate(db: Executor, id: string) {
    return db
      .selectFrom('app.event_templates')
      .select(['id', 'title', 'event_type', 'weekday', 'time_msk'])
      .where('id', '=', id)
      .executeTakeFirst()
  },

  async countTemplates(db: Executor) {
    const row = await db
      .selectFrom('app.event_templates')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .executeTakeFirstOrThrow()
    return Number(row.count)
  },

  async createTemplate(
    tx: Executor,
    values: {
      title: string
      eventType: EventType
      description: string
      weekday: number
      time: string
      createdBy: string
    },
  ) {
    const row = await tx
      .insertInto('app.event_templates')
      .values({
        title: values.title,
        event_type: values.eventType,
        description: values.description,
        weekday: values.weekday,
        time_msk: values.time,
        created_by: values.createdBy,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
    return row.id
  },

  /** Удаляет шаблон; возвращает удалённую строку или undefined. */
  deleteTemplate(tx: Executor, id: string) {
    return tx
      .deleteFrom('app.event_templates')
      .where('id', '=', id)
      .returning(['id', 'title'])
      .executeTakeFirst()
  },

  /** Сериализует создание шаблонов, чтобы лимит 50 не обходился гонкой. */
  async lockTemplates(tx: Executor) {
    await sql`select pg_advisory_xact_lock(${TEMPLATES_LOCK_KEY})`.execute(tx)
  },
}
