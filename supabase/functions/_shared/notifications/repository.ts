import type { Executor } from '../db/client.ts'
import type { Database } from '../db/database.types.ts'

export type NotificationInsert =
  Database['app']['Tables']['user_notifications']['Insert']

export const notificationRepository = {
  /** Повтор с тем же источником не создаёт дубликат; возвращает id или undefined. */
  async insertOnce(tx: Executor, row: NotificationInsert) {
    const inserted = await tx
      .insertInto('app.user_notifications')
      .values(row)
      .onConflict((conflict) =>
        conflict
          .columns(['recipient_id', 'source_kind', 'source_id', 'kind'])
          .doNothing(),
      )
      .returning('id')
      .executeTakeFirst()
    return inserted?.id
  },

  listForRecipient(db: Executor, recipientId: string) {
    return db
      .selectFrom('app.user_notifications')
      .selectAll()
      .where('recipient_id', '=', recipientId)
      .orderBy('created_at', 'desc')
      .execute()
  },
}
