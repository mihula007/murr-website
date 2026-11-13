import type { Executor } from '../db/client.ts'

/** Пользователи Supabase Auth (`auth.users`): только чтение. */
export const userRepository = {
  findById(db: Executor, id: string) {
    return db
      .selectFrom('auth.users')
      .select(['id', 'email', 'email_confirmed_at'])
      .where('id', '=', id)
      .executeTakeFirst()
  },

  findByEmail(db: Executor, email: string) {
    return db
      .selectFrom('auth.users')
      .select(['id', 'email', 'email_confirmed_at'])
      .where('email', '=', email)
      .executeTakeFirst()
  },

  /** Идёт удаление аккаунта (служебная запись этапа 11). */
  async deletionPending(db: Executor, id: string) {
    const row = await db
      .selectFrom('app.user_deletions')
      .select('user_id')
      .where('user_id', '=', id)
      .executeTakeFirst()
    return !!row
  },
}
