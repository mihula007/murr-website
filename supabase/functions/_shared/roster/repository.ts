import type { Executor } from '../db/client.ts'

export const rosterRepository = {
  async countByRoles(db: Executor, roles: readonly string[]) {
    const row = await db
      .selectFrom('app.profiles')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('access_role', 'in', roles)
      .executeTakeFirstOrThrow()
    return Number(row.count)
  },

  /** Карточки с ролью из списка, по нику; без закрытых полей профиля. */
  listByRoles(db: Executor, roles: readonly string[]) {
    return db
      .selectFrom('app.profiles as p')
      .innerJoin('app.character_classes as c', 'c.id', 'p.class_id')
      .select([
        'p.id',
        'p.game_nickname',
        'p.class_id',
        'c.name as class_name',
        'p.avatar_path',
        'p.access_role',
      ])
      .where('p.access_role', 'in', roles)
      .orderBy('p.game_nickname')
      .orderBy('p.id')
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
