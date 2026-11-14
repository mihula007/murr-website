import { sql, type RawBuilder } from 'kysely'
import type { Executor } from '../db/client.ts'
import { ACTIVE_STATUSES } from '../applications/repository.ts'
import type { AccountSort, SortDirection } from '../contracts/accounts.ts'

export type AccountQuery = {
  search: string | null
  sort: AccountSort
  direction: SortDirection
}

/** Ключ курсора: значение сортировки и `id` последней строки. */
export type AccountKey = { value: string | number; id: string }

/** Порядок ролей при сортировке: от администратора к кандидату. */
const ROLE_RANK = sql<number>`case p.access_role
  when 'admin' then 0 when 'officer' then 1 when 'member' then 2
  when 'reader' then 3 else 4 end`

/**
 * Выражение сортировки. Пустая дата вступления — в конце при любом
 * направлении: заменяется крайней датой со стороны конца списка.
 */
function sortExpression(sort: AccountSort, direction: SortDirection) {
  const expressions: Record<AccountSort, RawBuilder<string | number>> = {
    nickname: sql<string>`p.game_nickname`,
    name: sql<string>`p.display_name`,
    class: sql<string>`c.name`,
    email: sql<string>`coalesce(u.email, '')`,
    role: ROLE_RANK,
    registered: sql<string>`p.created_at`,
    joined:
      direction === 'asc'
        ? sql<string>`coalesce(p.joined_on, date '9999-12-31')`
        : sql<string>`coalesce(p.joined_on, date '0001-01-01')`,
  }
  return expressions[sort]
}

/** `%…%` для ilike: `\`, `%` и `_` поиска — обычные символы. */
function containsPattern(search: string) {
  return `%${search.replace(/[\\%_]/g, '\\$&')}%`
}

/** Профили с email, классом, последней заявкой и признаком удаления. */
function accounts(db: Executor) {
  return db
    .selectFrom('app.profiles as p')
    .innerJoin('auth.users as u', 'u.id', 'p.id')
    .innerJoin('app.character_classes as c', 'c.id', 'p.class_id')
    .select((eb) => [
      'p.id',
      'p.game_nickname',
      'p.display_name',
      'u.email',
      'c.name as class_name',
      'p.access_role',
      'p.created_at',
      'p.joined_on',
      'p.is_primary_admin',
      eb
        .exists(
          eb
            .selectFrom('app.join_applications as a')
            .select('a.id')
            .whereRef('a.applicant_id', '=', 'p.id')
            .where('a.status', 'in', ACTIVE_STATUSES),
        )
        .as('has_active_application'),
      eb
        .selectFrom('app.join_applications as a')
        .select('a.status')
        .whereRef('a.applicant_id', '=', 'p.id')
        .orderBy('a.submitted_at', 'desc')
        .orderBy('a.id', 'desc')
        .limit(1)
        .as('application_status'),
      eb
        .exists(
          eb
            .selectFrom('app.user_deletions as d')
            .select('d.user_id')
            .whereRef('d.user_id', '=', 'p.id'),
        )
        .as('deletion_pending'),
    ])
}

function filtered(db: Executor, search: string | null) {
  let query = accounts(db)
  if (search) {
    const pattern = containsPattern(search)
    query = query.where((eb) =>
      eb.or([
        eb('p.game_nickname', 'ilike', pattern),
        eb('p.display_name', 'ilike', pattern),
        eb('u.email', 'ilike', pattern),
        eb('c.name', 'ilike', pattern),
      ]),
    )
  }
  return query
}

export const accountRepository = {
  /** Страница по выбранной сортировке (keyset после `(значение, id)`). */
  listPage(
    db: Executor,
    options: AccountQuery,
    after: AccountKey | null,
    limit: number,
  ) {
    const key = sortExpression(options.sort, options.direction)
    let query = filtered(db, options.search).select(key.as('sort_key'))
    if (after) {
      query = query.where(
        options.direction === 'asc'
          ? sql<boolean>`(${key}, p.id) > (${after.value}, ${after.id}::uuid)`
          : sql<boolean>`(${key}, p.id) < (${after.value}, ${after.id}::uuid)`,
      )
    }
    return query
      .orderBy(key, options.direction)
      .orderBy('p.id', options.direction)
      .limit(limit)
      .execute()
  },

  async count(db: Executor, search: string | null) {
    const row = await filtered(db, search)
      .clearSelect()
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .executeTakeFirstOrThrow()
    return Number(row.count)
  },

  findById(db: Executor, id: string) {
    return accounts(db).where('p.id', '=', id).executeTakeFirst()
  },

  /** Поля карточки (ADM-03), которых нет в строке списка. */
  card(db: Executor, id: string) {
    return db
      .selectFrom('app.profiles as p')
      .innerJoin('auth.users as u', 'u.id', 'p.id')
      .select([
        'p.city',
        'p.birth_date',
        'p.about',
        'p.avatar_path',
        'p.pa',
        'p.pz',
        'p.bu',
        'p.hp',
        'p.bd',
        'p.character_stats_source',
        // Только признак: хеш пароля не выбирается.
        sql<boolean>`coalesce(u.encrypted_password, '') <> ''`.as(
          'password_set',
        ),
      ])
      .where('p.id', '=', id)
      .executeTakeFirst()
  },

  /** Ссылки на снаряжение последней заявки. */
  async latestApplicationLinks(db: Executor, userId: string) {
    const rows = await db
      .selectFrom('app.application_equipment_links as l')
      .innerJoin('app.join_applications as a', 'a.id', 'l.application_id')
      .select('l.url')
      .where(
        'a.id',
        '=',
        db
          .selectFrom('app.join_applications')
          .select('id')
          .where('applicant_id', '=', userId)
          .orderBy('submitted_at', 'desc')
          .orderBy('id', 'desc')
          .limit(1),
      )
      .orderBy('l.position')
      .execute()
    return rows.map((row) => row.url)
  },

  /**
   * Блокирует строки всех администраторов до конца транзакции. Вызывается
   * первым в смене роли, всегда в одном порядке, — параллельные понижения
   * ждут друг друга без взаимной блокировки и не оставят клан без
   * администратора (ACL-07, ADM-06).
   */
  lockAdmins(tx: Executor) {
    return tx
      .selectFrom('app.profiles')
      .select(['id', 'is_primary_admin'])
      .where('access_role', '=', 'admin')
      .orderBy('id')
      .forUpdate()
      .execute()
  },
}
