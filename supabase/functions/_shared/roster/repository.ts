import type { Executor } from '../db/client.ts'

/** Ключ сортировки карточек: ник и `id` (последний ключ — для однозначности). */
export type NicknameKey = { gameNickname: string; id: string }

export type CardPageOptions = {
  roles: readonly string[]
  classId: number | null
  after: NicknameKey | null
  limit: number
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
