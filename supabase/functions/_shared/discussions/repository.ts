import { sql } from 'kysely'
import type { DiscussionParent, Reaction } from '../contracts/discussions.ts'
import type { Executor } from '../db/client.ts'
import { INTERNAL_ROLES } from '../membership.ts'

/** Колонка ветки для каждого вида родителя. */
const PARENT_COLUMN = {
  event: 'event_id',
  vote: 'vote_id',
  publication: 'publication_id',
  market: 'market_listing_id',
} as const satisfies Record<DiscussionParent, string>

/** Ключ страницы: время создания и `id`, от новых к старым. */
export type MessageKey = { createdAt: string; id: string }

/** Сообщение с автором и цитатой ответа. */
function selectMessages(db: Executor) {
  return db
    .selectFrom('app.discussion_messages as m')
    .leftJoin('app.profiles as author', 'author.id', 'm.author_id')
    .leftJoin('app.discussion_messages as r', 'r.id', 'm.reply_to_id')
    .leftJoin('app.profiles as r_author', 'r_author.id', 'r.author_id')
    .select([
      'm.id',
      'm.thread_id',
      'm.author_id',
      'm.body',
      'm.created_at',
      'm.edited_at',
      'm.changed_at',
      'author.game_nickname as author_nickname',
      'author.avatar_path as author_avatar_path',
      'author.access_role as author_role',
      'r.id as reply_id',
      'r.body as reply_body',
      'r_author.game_nickname as reply_nickname',
    ])
}

export type MessageRow = Awaited<
  ReturnType<ReturnType<typeof selectMessages>['executeTakeFirstOrThrow']>
>

export const discussionRepository = {
  async findThread(db: Executor, parent: DiscussionParent, parentId: string) {
    const row = await db
      .selectFrom('app.discussion_threads')
      .where(PARENT_COLUMN[parent], '=', parentId)
      .select('id')
      .executeTakeFirst()
    return row?.id ?? null
  },

  /** Ветка создаётся при первом сообщении; повтор и гонка не дублируют её. */
  async ensureThread(tx: Executor, parent: DiscussionParent, parentId: string) {
    await tx
      .insertInto('app.discussion_threads')
      .values({ [PARENT_COLUMN[parent]]: parentId })
      .onConflict((oc) => oc.column(PARENT_COLUMN[parent]).doNothing())
      .execute()
    const id = await discussionRepository.findThread(tx, parent, parentId)
    if (!id) {
      throw new Error('Ветка обсуждения не создана')
    }
    return id
  },

  /** Страница ветки по убыванию (новые первыми), `limit` — с запасом +1. */
  page(
    db: Executor,
    threadId: string,
    after: MessageKey | null,
    limit: number,
  ) {
    let query = selectMessages(db).where('m.thread_id', '=', threadId)
    if (after) {
      query = query.where((eb) =>
        eb(
          eb.refTuple('m.created_at', 'm.id'),
          '<',
          eb.tuple(after.createdAt, after.id),
        ),
      )
    }
    return query
      .orderBy('m.created_at', 'desc')
      .orderBy('m.id', 'desc')
      .limit(limit)
      .execute()
  },

  /** Созданные, правленые и с изменёнными реакциями после `since` (Q-58). */
  changedSince(db: Executor, threadId: string, since: string, limit: number) {
    return selectMessages(db)
      .where('m.thread_id', '=', threadId)
      .where('m.changed_at', '>', since)
      .orderBy('m.changed_at', 'asc')
      .orderBy('m.id', 'asc')
      .limit(limit)
      .execute()
  },

  /** Одно сообщение с автором и цитатой — ответ операции записи. */
  message(db: Executor, id: string) {
    return selectMessages(db).where('m.id', '=', id).executeTakeFirstOrThrow()
  },

  /** Сообщение и родитель его ветки. */
  findMessage(db: Executor, id: string) {
    return db
      .selectFrom('app.discussion_messages as m')
      .innerJoin('app.discussion_threads as t', 't.id', 'm.thread_id')
      .leftJoin('app.profiles as author', 'author.id', 'm.author_id')
      .where('m.id', '=', id)
      .select([
        'm.id',
        'm.thread_id',
        'm.author_id',
        'm.created_at',
        'author.access_role as author_role',
        't.event_id',
        't.vote_id',
        't.publication_id',
        't.market_listing_id',
      ])
      .executeTakeFirst()
  },

  /** Сообщение под блокировкой правки. */
  lockMessage(tx: Executor, id: string) {
    return tx
      .selectFrom('app.discussion_messages')
      .where('id', '=', id)
      .select(['id', 'thread_id', 'author_id', 'created_at'])
      .forUpdate()
      .executeTakeFirst()
  },

  async insertMessage(
    tx: Executor,
    values: {
      threadId: string
      authorId: string
      replyToId: string | null
      body: string
      at: string
    },
  ) {
    const row = await tx
      .insertInto('app.discussion_messages')
      .values({
        thread_id: values.threadId,
        author_id: values.authorId,
        reply_to_id: values.replyToId,
        body: values.body,
        created_at: values.at,
        changed_at: values.at,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
    return row.id
  },

  async updateBody(tx: Executor, id: string, body: string, at: string) {
    await tx
      .updateTable('app.discussion_messages')
      .set({ body, edited_at: at, changed_at: at })
      .where('id', '=', id)
      .execute()
  },

  /** Отметка изменения сообщения для опроса (реакции). */
  async touch(tx: Executor, id: string, at: string) {
    await tx
      .updateTable('app.discussion_messages')
      .set({
        changed_at: sql<string>`greatest(changed_at, ${at}::timestamptz)`,
      })
      .where('id', '=', id)
      .execute()
  },

  /** Снимает свою реакцию, если она есть, иначе ставит (DSC-11). */
  async toggleReaction(
    tx: Executor,
    values: { messageId: string; userId: string; emoji: Reaction; at: string },
  ) {
    const removed = await tx
      .deleteFrom('app.discussion_reactions')
      .where('message_id', '=', values.messageId)
      .where('user_id', '=', values.userId)
      .where('emoji', '=', values.emoji)
      .returning('id')
      .executeTakeFirst()
    if (removed) {
      return 'removed' as const
    }
    await tx
      .insertInto('app.discussion_reactions')
      .values({
        message_id: values.messageId,
        user_id: values.userId,
        emoji: values.emoji,
        created_at: values.at,
      })
      .onConflict((oc) =>
        oc.columns(['message_id', 'user_id', 'emoji']).doNothing(),
      )
      .execute()
    return 'added' as const
  },

  /** Счётчики реакций сообщений и отметки зрителя. */
  reactionTotals(
    db: Executor,
    messageIds: readonly string[],
    viewerId: string,
  ) {
    if (messageIds.length === 0) {
      return Promise.resolve([])
    }
    return db
      .selectFrom('app.discussion_reactions')
      .where('message_id', 'in', messageIds)
      .groupBy(['message_id', 'emoji'])
      .select((eb) => [
        'message_id',
        'emoji',
        eb.fn.countAll<string>().as('count'),
        eb.fn
          .count<string>('id')
          .filterWhere('user_id', '=', viewerId)
          .as('mine'),
      ])
      .execute()
  },

  /** Поставившие реакции на сообщение; `limit` — с запасом +1. */
  reactionPeople(db: Executor, messageId: string, limit: number) {
    return db
      .selectFrom('app.discussion_reactions as x')
      .leftJoin('app.profiles as p', 'p.id', 'x.user_id')
      .where('x.message_id', '=', messageId)
      .select(['x.emoji', 'p.game_nickname', 'p.avatar_path'])
      .orderBy('x.created_at')
      .orderBy('x.id')
      .limit(limit)
      .execute()
  },

  /** Поднимает отметку прочтения, никогда не опуская её (DSC-12). */
  async markRead(
    tx: Executor,
    values: { threadId: string; userId: string; upTo: string },
  ) {
    await tx
      .insertInto('app.discussion_reads')
      .values({
        thread_id: values.threadId,
        user_id: values.userId,
        read_up_to: values.upTo,
      })
      .onConflict((oc) =>
        oc.columns(['thread_id', 'user_id']).doUpdateSet({
          read_up_to: sql<string>`greatest(app.discussion_reads.read_up_to, excluded.read_up_to)`,
        }),
      )
      .execute()
  },

  /** Самая поздняя отметка других участников ветки. */
  async othersReadUpTo(db: Executor, threadId: string, viewerId: string) {
    const row = await db
      .selectFrom('app.discussion_reads')
      .where('thread_id', '=', threadId)
      .where('user_id', '!=', viewerId)
      .select((eb) => eb.fn.max('read_up_to').as('up_to'))
      .executeTakeFirst()
    return row?.up_to ?? null
  },

  /** Прочитавшие сообщение, кроме автора; `limit` — с запасом +1. */
  readers(
    db: Executor,
    values: {
      threadId: string
      createdAt: string
      authorId: string | null
      limit: number
    },
  ) {
    let query = db
      .selectFrom('app.discussion_reads as d')
      .innerJoin('app.profiles as p', 'p.id', 'd.user_id')
      .where('d.thread_id', '=', values.threadId)
      .where('d.read_up_to', '>=', values.createdAt)
    if (values.authorId) {
      query = query.where('d.user_id', '!=', values.authorId)
    }
    return query
      .select(['p.game_nickname', 'p.avatar_path'])
      .orderBy('p.game_nickname')
      .limit(values.limit)
      .execute()
  },

  /**
   * Адресаты упоминаний (DSC-07): внутренние участники, чей ник без учёта
   * регистра совпал с кандидатом.
   */
  mentionTargets(db: Executor, candidates: readonly string[]) {
    if (candidates.length === 0) {
      return Promise.resolve([])
    }
    return db
      .selectFrom('app.profiles')
      .where(sql<string>`lower(game_nickname)`, 'in', candidates)
      .where('access_role', 'in', INTERNAL_ROLES)
      .select(['id', 'game_nickname'])
      .execute()
  },

  /** Число сообщений в ветках родителей одного вида (DSC-01). */
  async countByParent(
    db: Executor,
    parent: DiscussionParent,
    parentIds: readonly string[],
  ) {
    const counts = new Map<string, number>()
    if (parentIds.length === 0) {
      return counts
    }
    const column = PARENT_COLUMN[parent]
    const rows = await db
      .selectFrom('app.discussion_threads as t')
      .innerJoin('app.discussion_messages as m', 'm.thread_id', 't.id')
      .where(`t.${column}`, 'in', parentIds)
      .groupBy(`t.${column}`)
      .select((eb) => [
        eb.ref(`t.${column}`).as('parent_id'),
        eb.fn.countAll<string>().as('count'),
      ])
      .execute()
    for (const row of rows) {
      if (row.parent_id) {
        counts.set(row.parent_id, Number(row.count))
      }
    }
    return counts
  },
}
