import type { Executor } from '../db/client.ts'
import type { Database } from '../db/database.types.ts'

type Tables = Database['app']['Tables']
export type ProfileInsert = Tables['profiles']['Insert']
export type ProfileUpdate = Tables['profiles']['Update']

export const NICKNAME_CONSTRAINT = 'profiles_game_nickname_key'
export const PROFILE_PK_CONSTRAINT = 'profiles_pkey'

export const profileRepository = {
  findById(db: Executor, id: string) {
    return db
      .selectFrom('app.profiles')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst()
  },

  /** Ник занят другим пользователем (сравнение с учётом регистра, Q-27). */
  async nicknameTaken(db: Executor, nickname: string, exceptId?: string) {
    let query = db
      .selectFrom('app.profiles')
      .select('id')
      .where('game_nickname', '=', nickname)
    if (exceptId) {
      query = query.where('id', '<>', exceptId)
    }
    return (await query.executeTakeFirst()) !== undefined
  },

  async adminExists(db: Executor) {
    const row = await db
      .selectFrom('app.profiles')
      .select('id')
      .where('access_role', '=', 'admin')
      .limit(1)
      .executeTakeFirst()
    return row !== undefined
  },

  insert(db: Executor, row: ProfileInsert) {
    return db.insertInto('app.profiles').values(row).execute()
  },

  /** Профиль с блокировкой строки до конца транзакции (смена роли). */
  findByIdForUpdate(tx: Executor, id: string) {
    return tx
      .selectFrom('app.profiles')
      .selectAll()
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst()
  },

  update(db: Executor, id: string, changes: ProfileUpdate) {
    return db
      .updateTable('app.profiles')
      .set(changes)
      .where('id', '=', id)
      .execute()
  },

  async className(db: Executor, classId: number) {
    const row = await db
      .selectFrom('app.character_classes')
      .select('name')
      .where('id', '=', classId)
      .executeTakeFirst()
    return row?.name ?? ''
  },
}
