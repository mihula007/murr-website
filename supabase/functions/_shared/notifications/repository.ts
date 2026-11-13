import { sql, type SelectQueryBuilder } from 'kysely'
import type { NewsSection } from '../contracts/notifications.ts'
import type { Executor } from '../db/client.ts'
import type { Database } from '../db/database.types.ts'
import type { DB } from '../db/schema.ts'

export type NotificationInsert =
  Database['app']['Tables']['user_notifications']['Insert']

type CountQuery = {
  userId: string
  /** ISO-время отметки просмотра. */
  since: string
  cap: number
}

/** Подсчёт с остановкой на `cap`: точное число больше не нужно (99+). */
async function cappedCount(
  db: Executor,
  query: SelectQueryBuilder<DB, keyof DB, { one: number }>,
  cap: number,
): Promise<number> {
  const row = await db
    .selectFrom(query.limit(cap).as('n'))
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .executeTakeFirstOrThrow()
  return Number(row.count)
}

/** Новые объекты раздела после отметки просмотра, без своих (Q-67). */
const newsCounters: Record<
  NewsSection,
  (db: Executor, query: CountQuery) => Promise<number>
> = {
  events: (db, { userId, since, cap }) =>
    cappedCount(
      db,
      db
        .selectFrom('app.events')
        .select(sql<number>`1`.as('one'))
        .where('created_at', '>', since)
        .where((eb) =>
          eb.or([eb('created_by', 'is', null), eb('created_by', '!=', userId)]),
        ),
      cap,
    ),
  votes: (db, { userId, since, cap }) =>
    cappedCount(
      db,
      db
        .selectFrom('app.votes')
        .select(sql<number>`1`.as('one'))
        .where('created_at', '>', since)
        .where((eb) =>
          eb.or([eb('created_by', 'is', null), eb('created_by', '!=', userId)]),
        ),
      cap,
    ),
  publications: (db, { userId, since, cap }) =>
    cappedCount(
      db,
      db
        .selectFrom('app.publications')
        .select(sql<number>`1`.as('one'))
        .where('status', '=', 'published')
        .where('published_at', '>', since)
        .where((eb) =>
          eb.or([eb('author_id', 'is', null), eb('author_id', '!=', userId)]),
        ),
      cap,
    ),
  market: (db, { userId, since, cap }) =>
    cappedCount(
      db,
      db
        .selectFrom('app.market_listings')
        .select(sql<number>`1`.as('one'))
        .where('status', '=', 'published')
        .where('published_at', '>', since)
        .where((eb) =>
          eb.or([eb('author_id', 'is', null), eb('author_id', '!=', userId)]),
        ),
      cap,
    ),
  applications: (db, { userId, since, cap }) =>
    cappedCount(
      db,
      db
        .selectFrom('app.join_applications')
        .select(sql<number>`1`.as('one'))
        .where('submitted_at', '>', since)
        .where('applicant_id', '!=', userId),
      cap,
    ),
  accounts: (db, { userId, since, cap }) =>
    cappedCount(
      db,
      db
        .selectFrom('app.profiles')
        .select(sql<number>`1`.as('one'))
        .where('created_at', '>', since)
        .where('id', '!=', userId),
      cap,
    ),
}

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

  /** Все уведомления получателя — для тестов и будущего удаления (NTF-13). */
  listForRecipient(db: Executor, recipientId: string) {
    return db
      .selectFrom('app.user_notifications')
      .selectAll()
      .where('recipient_id', '=', recipientId)
      .orderBy('created_at', 'desc')
      .execute()
  },

  /** Последние уведомления получателя для панели (Q-64). */
  recent(db: Executor, recipientId: string, limit: number) {
    return db
      .selectFrom('app.user_notifications')
      .select([
        'id',
        'kind',
        'title',
        'body',
        'target_kind',
        'target_id',
        'created_at',
        'read_at',
      ])
      .where('recipient_id', '=', recipientId)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(limit)
      .execute()
  },

  async unreadCount(db: Executor, recipientId: string) {
    const row = await db
      .selectFrom('app.user_notifications')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('recipient_id', '=', recipientId)
      .where('read_at', 'is', null)
      .executeTakeFirstOrThrow()
    return Number(row.count)
  },

  /** Отмечает одно своё уведомление; false — нет такого у получателя. */
  async markRead(db: Executor, recipientId: string, id: string, now: Date) {
    const row = await db
      .updateTable('app.user_notifications')
      .set({ read_at: sql<string>`coalesce(read_at, ${now.toISOString()})` })
      .where('id', '=', id)
      .where('recipient_id', '=', recipientId)
      .returning('id')
      .executeTakeFirst()
    return row !== undefined
  },

  async markAllRead(db: Executor, recipientId: string, now: Date) {
    await db
      .updateTable('app.user_notifications')
      .set({ read_at: now.toISOString() })
      .where('recipient_id', '=', recipientId)
      .where('read_at', 'is', null)
      .execute()
  },
}

export const sectionViewRepository = {
  /**
   * Отметки разделов пользователя; недостающие создаются с `now` — первый
   * доступ к разделу начинается с нуля (Q-67).
   */
  async ensure(
    db: Executor,
    userId: string,
    sections: readonly NewsSection[],
    now: Date,
  ) {
    if (sections.length === 0) {
      return new Map<NewsSection, string>()
    }
    await db
      .insertInto('app.section_views')
      .values(
        sections.map((section) => ({
          user_id: userId,
          section,
          seen_at: now.toISOString(),
        })),
      )
      .onConflict((conflict) =>
        conflict.columns(['user_id', 'section']).doNothing(),
      )
      .execute()
    const rows = await db
      .selectFrom('app.section_views')
      .select(['section', 'seen_at'])
      .where('user_id', '=', userId)
      .where('section', 'in', sections)
      .execute()
    return new Map(rows.map((row) => [row.section as NewsSection, row.seen_at]))
  },

  /** Поднимает отметку раздела до `now`, не опуская её. */
  async markSeen(
    db: Executor,
    userId: string,
    section: NewsSection,
    now: Date,
  ) {
    await db
      .insertInto('app.section_views')
      .values({ user_id: userId, section, seen_at: now.toISOString() })
      .onConflict((conflict) =>
        conflict.columns(['user_id', 'section']).doUpdateSet({
          seen_at: sql`greatest(app.section_views.seen_at, excluded.seen_at)`,
        }),
      )
      .execute()
  },

  countNew(db: Executor, section: NewsSection, query: CountQuery) {
    return newsCounters[section](db, query)
  },
}
