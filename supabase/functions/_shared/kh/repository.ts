import { sql } from 'kysely'
import type { Executor } from '../db/client.ts'
import type { KhQueueId } from '../contracts/kh.ts'

const TABLE = 'app.kh_queue_entries' as const

export const khQueueRepository = {
  listPage(
    db: Executor,
    queueKey: KhQueueId,
    afterId: string | null,
    limit: number,
  ) {
    let query = db
      .selectFrom(TABLE)
      .innerJoin(
        'app.profiles',
        'app.profiles.id',
        'app.kh_queue_entries.user_id',
      )
      .select([
        'app.kh_queue_entries.id',
        'app.kh_queue_entries.user_id',
        'app.profiles.game_nickname',
      ])
      .where('app.kh_queue_entries.queue_key', '=', queueKey)
    if (afterId) {
      query = query.where(
        'app.kh_queue_entries.id',
        '>',
        sql<number>`cast(${afterId} as bigint)`,
      )
    }
    return query
      .orderBy('app.kh_queue_entries.id', 'asc')
      .limit(limit)
      .execute()
  },

  async join(db: Executor, queueKey: KhQueueId, userId: string) {
    return db
      .insertInto(TABLE)
      .values({ queue_key: queueKey, user_id: userId })
      .onConflict((conflict) =>
        conflict.columns(['queue_key', 'user_id']).doNothing(),
      )
      .returning('id')
      .executeTakeFirst()
  },

  async leave(
    db: Executor,
    queueKey: KhQueueId,
    entryId: string,
    userId: string,
  ) {
    return db
      .deleteFrom(TABLE)
      .where('queue_key', '=', queueKey)
      .where('id', '=', sql<number>`cast(${entryId} as bigint)`)
      .where('user_id', '=', userId)
      .returning('id')
      .executeTakeFirst()
  },

  async issue(db: Executor, queueKey: KhQueueId, entryId: string) {
    return db
      .deleteFrom(TABLE)
      .where('queue_key', '=', queueKey)
      .where('id', '=', sql<number>`cast(${entryId} as bigint)`)
      .returning('id')
      .executeTakeFirst()
  },

  async deleteForUser(db: Executor, userId: string) {
    await db.deleteFrom(TABLE).where('user_id', '=', userId).execute()
  },
}
