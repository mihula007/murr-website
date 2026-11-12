import type { ExpressionBuilder } from 'kysely'
import type { MarketCategory } from '../contracts/market.ts'
import type { MaterialStatus } from '../contracts/materials.ts'
import type { RichDocument } from '../contracts/rich-text.ts'
import type { Executor } from '../db/client.ts'
import type { Json } from '../db/database.types.ts'
import type { DB } from '../db/schema.ts'

export type ListingFilter = {
  status: MaterialStatus
  authorId: string | null
  category: MarketCategory | null
  search: { pattern: string; categories: MarketCategory[] } | null
}

export type ListingValues = {
  category: MarketCategory
  title: string
  summary: string | null
  content: RichDocument
  searchText: string
  excerpt: string
  coverUrl: string | null
  status: MaterialStatus
  discussionEnabled: boolean
}

type Eb = ExpressionBuilder<
  DB & { l: DB['app.market_listings']; author: DB['app.profiles'] },
  'l' | 'author'
>

function selectListings(db: Executor) {
  return db
    .selectFrom('app.market_listings as l')
    .leftJoin('app.profiles as author', 'author.id', 'l.author_id')
    .select([
      'l.id',
      'l.category',
      'l.title',
      'l.summary',
      'l.excerpt',
      'l.cover_url',
      'l.status',
      'l.discussion_enabled',
      'l.author_id',
      'l.created_at',
      'l.updated_at',
      'l.published_at',
      'author.game_nickname as author_nickname',
    ])
}

export type ListingRow = Awaited<
  ReturnType<ReturnType<typeof selectListings>['executeTakeFirstOrThrow']>
>

/** Условия ленты: статус, автор, категория, поиск (MKT-11). */
function where(filter: ListingFilter) {
  return (eb: Eb) => {
    const conditions = [eb('l.status', '=', filter.status)]
    if (filter.authorId) {
      conditions.push(eb('l.author_id', '=', filter.authorId))
    }
    if (filter.category) {
      conditions.push(eb('l.category', '=', filter.category))
    }
    const search = filter.search
    if (search) {
      // Подпись автора объявления видна всегда (MKT-03): ищем и по нику.
      conditions.push(
        eb.or([
          eb('l.search_text', 'ilike', search.pattern),
          eb('author.game_nickname', 'ilike', search.pattern),
          ...(search.categories.length > 0
            ? [eb('l.category', 'in', search.categories)]
            : []),
        ]),
      )
    }
    return eb.and(conditions)
  }
}

function toColumns(values: ListingValues) {
  return {
    category: values.category,
    title: values.title,
    summary: values.summary,
    content: values.content as unknown as NonNullable<Json>,
    search_text: values.searchText,
    excerpt: values.excerpt,
    cover_url: values.coverUrl,
    status: values.status,
    discussion_enabled: values.discussionEnabled,
  }
}

export const listingRepository = {
  /** Страница по обновлению, новые сверху (MKT-11). */
  async list(
    db: Executor,
    filter: ListingFilter,
    window: { offset: number; limit: number },
  ) {
    return selectListings(db)
      .where(where(filter))
      .orderBy('l.updated_at', 'desc')
      .orderBy('l.id', 'desc')
      .offset(window.offset)
      .limit(window.limit)
      .execute()
  },

  async count(db: Executor, filter: ListingFilter) {
    const row = await db
      .selectFrom('app.market_listings as l')
      .leftJoin('app.profiles as author', 'author.id', 'l.author_id')
      .where(where(filter))
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .executeTakeFirstOrThrow()
    return Number(row.count)
  },

  async find(db: Executor, id: string) {
    return selectListings(db).where('l.id', '=', id).executeTakeFirst()
  },

  async content(db: Executor, id: string) {
    const row = await db
      .selectFrom('app.market_listings')
      .where('id', '=', id)
      .select('content')
      .executeTakeFirst()
    return row?.content ?? null
  },

  /** Родитель обсуждения под блокировкой чтения: запись ждёт снятия и удаления. */
  lockShared(tx: Executor, id: string) {
    return tx
      .selectFrom('app.market_listings')
      .where('id', '=', id)
      .select(['id', 'title', 'author_id', 'status', 'discussion_enabled'])
      .forShare()
      .executeTakeFirst()
  },

  /** Строка под блокировкой правки (`FOR UPDATE`). */
  async lock(tx: Executor, id: string) {
    return tx
      .selectFrom('app.market_listings')
      .where('id', '=', id)
      .select(['id', 'author_id', 'status', 'updated_at', 'published_at'])
      .forUpdate()
      .executeTakeFirst()
  },

  async create(
    tx: Executor,
    values: ListingValues & { authorId: string; now: string },
  ) {
    const row = await tx
      .insertInto('app.market_listings')
      .values({
        ...toColumns(values),
        author_id: values.authorId,
        created_at: values.now,
        updated_at: values.now,
        published_at: values.status === 'published' ? values.now : null,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
    return row.id
  },

  async update(
    tx: Executor,
    id: string,
    values: ListingValues & { now: string; publishedAt: string | null },
  ) {
    await tx
      .updateTable('app.market_listings')
      .set({
        ...toColumns(values),
        updated_at: values.now,
        published_at: values.publishedAt,
      })
      .where('id', '=', id)
      .execute()
  },

  async unpublish(tx: Executor, id: string, now: string) {
    await tx
      .updateTable('app.market_listings')
      .set({ status: 'draft', updated_at: now })
      .where('id', '=', id)
      .execute()
  },

  async delete(tx: Executor, id: string) {
    await tx.deleteFrom('app.market_listings').where('id', '=', id).execute()
  },
}
