import { sql } from 'kysely'
import type { Executor } from '../db/client.ts'
import type { KhQueueId } from '../contracts/kh.ts'

const ENTRIES = 'app.kh_queue_entries' as const
const SETTINGS = 'app.kh_queue_settings' as const
const WAITLIST = 'app.kh_queue_rejoin_waitlist' as const

type QueueEntryRow = {
  id: number
  queue_key: KhQueueId
  user_id: string | null
  game_nickname: string
  auto_rejoin: boolean
}

async function lockSettings(db: Executor, mode: 'share' | 'update') {
  const query = db
    .selectFrom(SETTINGS)
    .select('max_active_queues')
    .where('id', '=', true)
  const row = await (
    mode === 'share' ? query.forShare() : query.forUpdate()
  ).executeTakeFirstOrThrow()
  return Number(row.max_active_queues)
}

async function lockUser(db: Executor, userId: string) {
  await db
    .selectFrom('app.profiles')
    .select('id')
    .where('id', '=', userId)
    .forUpdate()
    .executeTakeFirstOrThrow()
}

async function countEntries(db: Executor, userId: string) {
  const result = await db
    .selectFrom(ENTRIES)
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .where('user_id', '=', userId)
    .executeTakeFirstOrThrow()
  return Number(result.count)
}

async function refillWaitlist(db: Executor, userId: string, cap: number) {
  let active = await countEntries(db, userId)
  if (active >= cap) {
    return
  }
  const waiting = await db
    .selectFrom(WAITLIST)
    .select(['id', 'queue_key', 'game_nickname'])
    .where('user_id', '=', userId)
    .orderBy('requested_at', 'asc')
    .orderBy('id', 'asc')
    .execute()
  for (const entry of waiting) {
    if (active >= cap) {
      break
    }
    await db
      .insertInto(ENTRIES)
      .values({
        queue_key: entry.queue_key,
        user_id: userId,
        game_nickname: entry.game_nickname,
        auto_rejoin: true,
      })
      .execute()
    await db.deleteFrom(WAITLIST).where('id', '=', entry.id).execute()
    active += 1
  }
}

export const khQueueRepository = {
  lockSettings,

  async settings(db: Executor) {
    const row = await db
      .selectFrom(SETTINGS)
      .select('max_active_queues')
      .where('id', '=', true)
      .executeTakeFirstOrThrow()
    return { maxActiveQueues: Number(row.max_active_queues) }
  },

  lockUser,

  countEntries,

  async listPage(
    db: Executor,
    queueKey: KhQueueId,
    afterId: string | null,
    limit: number,
  ) {
    let query = db
      .selectFrom(`${ENTRIES} as e`)
      .leftJoin('app.profiles as p', 'p.id', 'e.user_id')
      .select([
        'e.id',
        'e.queue_key',
        'e.user_id',
        sql<string>`coalesce(p.game_nickname, e.game_nickname)`.as(
          'game_nickname',
        ),
        'e.auto_rejoin',
      ])
      .where('e.queue_key', '=', queueKey)
    if (afterId) {
      query = query.where('e.id', '>', sql<number>`cast(${afterId} as bigint)`)
    }
    return query.orderBy('e.id', 'asc').limit(limit).execute()
  },

  async entryById(db: Executor, queueKey: KhQueueId, entryId: string) {
    return db
      .selectFrom(ENTRIES)
      .select(['id', 'queue_key', 'user_id', 'game_nickname', 'auto_rejoin'])
      .where('queue_key', '=', queueKey)
      .where('id', '=', sql<number>`cast(${entryId} as bigint)`)
      .executeTakeFirst()
  },

  async lockEntryById(db: Executor, queueKey: KhQueueId, entryId: string) {
    return db
      .selectFrom(ENTRIES)
      .select(['id', 'queue_key', 'user_id', 'game_nickname', 'auto_rejoin'])
      .where('queue_key', '=', queueKey)
      .where('id', '=', sql<number>`cast(${entryId} as bigint)`)
      .forUpdate()
      .executeTakeFirst()
  },

  async join(
    db: Executor,
    queueKey: KhQueueId,
    userId: string,
    gameNickname: string,
    cap: number,
  ) {
    await lockUser(db, userId)
    if ((await countEntries(db, userId)) >= cap) {
      return null
    }
    const row = await db
      .insertInto(ENTRIES)
      .values({
        queue_key: queueKey,
        user_id: userId,
        game_nickname: gameNickname,
      })
      .returning('id')
      .executeTakeFirst()
    return row
  },

  async setLimit(db: Executor, maxActiveQueues: number) {
    await db
      .updateTable(SETTINGS)
      .set({
        max_active_queues: maxActiveQueues,
        updated_at: new Date().toISOString(),
      })
      .where('id', '=', true)
      .execute()

    const waiters = await db
      .selectFrom(WAITLIST)
      .select('user_id')
      .distinct()
      .execute()
    for (const waiter of waiters) {
      await lockUser(db, waiter.user_id)
      await refillWaitlist(db, waiter.user_id, maxActiveQueues)
    }
  },

  async setRepeat(
    db: Executor,
    queueKey: KhQueueId,
    entryId: string,
    userId: string,
    autoRejoin: boolean,
  ) {
    return db
      .updateTable(ENTRIES)
      .set({ auto_rejoin: autoRejoin })
      .where('queue_key', '=', queueKey)
      .where('id', '=', sql<number>`cast(${entryId} as bigint)`)
      .where('user_id', '=', userId)
      .returning('id')
      .executeTakeFirst()
  },

  async leave(
    db: Executor,
    queueKey: KhQueueId,
    entryId: string,
    userId: string,
    cap: number,
  ) {
    const removed = await db
      .deleteFrom(ENTRIES)
      .where('queue_key', '=', queueKey)
      .where('id', '=', sql<number>`cast(${entryId} as bigint)`)
      .where('user_id', '=', userId)
      .returning('id')
      .executeTakeFirst()
    if (removed) {
      await refillWaitlist(db, userId, cap)
    }
    return removed
  },

  async remove(db: Executor, entry: QueueEntryRow, cap: number) {
    const removed = await db
      .deleteFrom(ENTRIES)
      .where('queue_key', '=', entry.queue_key)
      .where('id', '=', entry.id)
      .returning('id')
      .executeTakeFirst()
    if (removed && entry.user_id) {
      await refillWaitlist(db, entry.user_id, cap)
    }
    return removed
  },

  async issue(db: Executor, entry: QueueEntryRow, cap: number) {
    const removed = await db
      .deleteFrom(ENTRIES)
      .where('queue_key', '=', entry.queue_key)
      .where('id', '=', entry.id)
      .returning('id')
      .executeTakeFirst()
    if (!removed || !entry.user_id) {
      return removed
    }
    const user = await db
      .selectFrom('app.profiles')
      .select('game_nickname')
      .where('id', '=', entry.user_id)
      .executeTakeFirst()
    const nickname = user?.game_nickname ?? entry.game_nickname
    if (entry.auto_rejoin) {
      await db
        .insertInto(WAITLIST)
        .values({
          queue_key: entry.queue_key,
          user_id: entry.user_id,
          game_nickname: nickname,
        })
        .execute()
    }
    await refillWaitlist(db, entry.user_id, cap)
    return removed
  },

  async deleteForUser(db: Executor, userId: string) {
    await db.deleteFrom(WAITLIST).where('user_id', '=', userId).execute()
    await db.deleteFrom(ENTRIES).where('user_id', '=', userId).execute()
  },
}
