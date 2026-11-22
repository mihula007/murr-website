import type { Executor } from '../db/client.ts'
import { sql } from 'kysely'

/** Ключ сортировки карточек: ник и `id` (последний ключ — для однозначности). */
export type NicknameKey = { gameNickname: string; id: string }

export type CardPageOptions = {
  roles: readonly string[]
  classId: number | null
  search?: string | undefined
  after: NicknameKey | null
  limit: number
}

/** Экранирует шаблонные знаки ILIKE, чтобы поиск считал их обычными буквами. */
function searchPattern(value: string) {
  return `%${value.replace(/[\\%_]/g, '\\$&')}%`
}

export const rosterRepository = {
  async countByRoles(db: Executor, roles: readonly string[]) {
    const row = await db
      .selectFrom('app.profiles')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('access_role', 'in', roles)
      .executeTakeFirstOrThrow()
    return Number(row.count)
  },

  /**
   * Страница карточек с ролью из списка, по нику; без закрытых полей
   * профиля. Keyset: строки после `(ник, id)` курсора, `limit` с запасом
   * на признак следующей страницы задаёт сервис.
   */
  listByRoles(db: Executor, options: CardPageOptions) {
    let query = db
      .selectFrom('app.profiles as p')
      .innerJoin('app.character_classes as c', 'c.id', 'p.class_id')
      .select([
        'p.id',
        'p.game_nickname',
        'p.class_id',
        'c.name as class_name',
        'p.avatar_path',
        'p.access_role',
        'p.pa',
        'p.pz',
        'p.bu',
        'p.hp',
        'p.bd',
      ])
      .where('p.access_role', 'in', options.roles)
    if (options.classId !== null) {
      query = query.where('p.class_id', '=', options.classId)
    }
    if (options.search) {
      const pattern = searchPattern(options.search)
      query = query.where((eb) =>
        eb.or([
          eb('p.game_nickname', 'ilike', pattern),
          eb('c.name', 'ilike', pattern),
        ]),
      )
    }
    if (options.after) {
      const { gameNickname, id } = options.after
      query = query.where((eb) =>
        eb(
          eb.refTuple('p.game_nickname', 'p.id'),
          '>',
          eb.tuple(gameNickname, id),
        ),
      )
    }
    return query
      .orderBy('p.game_nickname')
      .orderBy('p.id')
      .limit(options.limit)
      .execute()
  },

  /**
   * Число профилей с ролью из списка по каждому классу справочника, включая
   * нулевые. Неактивный класс попадает в список, только если в нём кто-то есть.
   */
  async classStats(db: Executor, roles: readonly string[]) {
    const rows = await db
      .selectFrom('app.character_classes as c')
      .leftJoin('app.profiles as p', (join) =>
        join.onRef('p.class_id', '=', 'c.id').on('p.access_role', 'in', roles),
      )
      .select((eb) => [
        'c.id',
        'c.name',
        eb.fn.count<string>('p.id').as('count'),
      ])
      .groupBy('c.id')
      .having((eb) =>
        eb.or([eb('c.is_active', '=', true), eb(eb.fn.count('p.id'), '>', 0)]),
      )
      .orderBy('c.sort_order')
      .execute()
    return rows.map((row) => ({
      classId: row.id,
      className: row.name,
      count: Number(row.count),
    }))
  },
}

/** Приватные данные только для операций динамики с серверной проверкой роли. */
export const rosterDynamicsRepository = {
  profile(db: Executor, userId: string) {
    return db
      .selectFrom('app.profiles as p')
      .innerJoin('app.character_classes as c', 'c.id', 'p.class_id')
      .select((eb) => [
        'p.id',
        'p.game_nickname',
        'p.display_name',
        'p.joined_on',
        'p.avatar_path',
        'p.access_role',
        'c.name as class_name',
        eb
          .exists(
            eb
              .selectFrom('app.user_deletions as d')
              .select('d.user_id')
              .whereRef('d.user_id', '=', 'p.id'),
          )
          .as('deletion_pending'),
      ])
      .where('p.id', '=', userId)
      .executeTakeFirst()
  },

  attendance(
    db: Executor,
    userId: string,
    cutoff: string | null,
    after: string | null,
    limit: number,
  ) {
    let query = db
      .selectFrom('app.event_activity_records as r')
      .innerJoin('app.events as e', 'e.id', 'r.event_id')
      .select((eb) => [
        sql<string>`to_char(date_trunc('week', e.starts_at at time zone 'Europe/Moscow'), 'YYYY-MM-DD')`.as(
          'week_start',
        ),
        eb.fn
          .sum<number>(sql`case when r.status = 'visited' then 1 else 0 end`)
          .as('visited'),
        eb.fn
          .sum<number>(sql`case when r.status = 'missed' then 1 else 0 end`)
          .as('missed'),
        eb.fn
          .sum<number>(sql`case when r.status = 'unmarked' then 1 else 0 end`)
          .as('unmarked'),
      ])
      .where('r.user_id', '=', userId)
      .where('e.closed_at', 'is not', null)
    if (cutoff) {
      query = query.where(
        sql`(e.starts_at at time zone 'Europe/Moscow')::date`,
        '>=',
        cutoff,
      )
    }
    if (after) {
      query = query.having(
        sql`to_char(date_trunc('week', e.starts_at at time zone 'Europe/Moscow'), 'YYYY-MM-DD')`,
        '<',
        after,
      )
    }
    return query
      .groupBy(
        sql`date_trunc('week', e.starts_at at time zone 'Europe/Moscow')`,
      )
      .orderBy('week_start', 'desc')
      .limit(limit)
      .execute()
  },
}
