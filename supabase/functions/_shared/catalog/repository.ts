import type { Executor } from '../db/client.ts'

export const catalogRepository = {
  activeClasses(db: Executor) {
    return db
      .selectFrom('app.character_classes')
      .select(['id', 'slug', 'name'])
      .where('is_active', '=', true)
      .orderBy('sort_order')
      .execute()
  },

  async isActiveClass(db: Executor, id: number) {
    const row = await db
      .selectFrom('app.character_classes')
      .select('id')
      .where('id', '=', id)
      .where('is_active', '=', true)
      .executeTakeFirst()
    return row !== undefined
  },
}
