import type { ExpressionBuilder } from 'kysely'
import type { PublicationCategory } from '../contracts/publications.ts'
import type { MaterialStatus } from '../contracts/materials.ts'
import type { RichDocument } from '../contracts/rich-text.ts'
import type { Executor } from '../db/client.ts'
import type { Json } from '../db/database.types.ts'
import type { DB } from '../db/schema.ts'

/** Фильтры ленты; `authorAlways` — искать по автору и при скрытой подписи. */
export type PublicationFilter = {
  status: MaterialStatus
  authorId: string | null
  category: PublicationCategory | null
  search: {
    pattern: string
    categories: PublicationCategory[]
    authorAlways: boolean
  } | null
}

export type PublicationValues = {
  category: PublicationCategory
  title: string
  summary: string | null
  content: RichDocument
  searchText: string
  excerpt: string
  coverUrl: string | null
  status: MaterialStatus
  showAuthor: boolean
  discussionEnabled: boolean
}

type Eb = ExpressionBuilder<
  DB & { p: DB['app.publications']; author: DB['app.profiles'] },
  'p' | 'author'
>

function selectPublications(db: Executor) {
  return db
    .selectFrom('app.publications as p')
    .leftJoin('app.profiles as author', 'author.id', 'p.author_id')
    .select([
      'p.id',
      'p.category',
      'p.title',
      'p.summary',
      'p.excerpt',
      'p.cover_url',
      'p.status',
      'p.show_author',
      'p.discussion_enabled',
      'p.author_id',
      'p.created_at',
      'p.updated_at',
      'p.published_at',
      'author.game_nickname as author_nickname',
    ])
}

export type PublicationRow = Awaited<
  ReturnType<ReturnType<typeof selectPublications>['executeTakeFirstOrThrow']>
>

/** Условия ленты: статус, автор, категория, поиск (PUB-09). */
function where(filter: PublicationFilter) {
  return (eb: Eb) => {
    const conditions = [eb('p.status', '=', filter.status)]
    if (filter.authorId) {
      conditions.push(eb('p.author_id', '=', filter.authorId))
    }
    if (filter.category) {
      conditions.push(eb('p.category', '=', filter.category))
    }
    const search = filter.search
    if (search) {
      const byAuthor = eb('author.game_nickname', 'ilike', search.pattern)
      conditions.push(
        eb.or([
          eb('p.search_text', 'ilike', search.pattern),
          // Скрытая подпись не раскрывается поиском (PUB-07).
          search.authorAlways
            ? byAuthor
            : eb.and([eb('p.show_author', '=', true), byAuthor]),
          ...(search.categories.length > 0
            ? [eb('p.category', 'in', search.categories)]
            : []),
        ]),
      )
    }
    return eb.and(conditions)
  }
}

export const publicationRepository = {
  /** Страница по обновлению, новые сверху (PUB-01). */
  async list(
    db: Executor,
    filter: PublicationFilter,
    window: { offset: number; limit: number },
  ) {
    return selectPublications(db)
      .where(where(filter))
      .orderBy('p.updated_at', 'desc')
      .orderBy('p.id', 'desc')
      .offset(window.offset)
      .limit(window.limit)
      .execute()
  },

  async count(db: Executor, filter: PublicationFilter) {
    const row = await db
      .selectFrom('app.publications as p')
      .leftJoin('app.profiles as author', 'author.id', 'p.author_id')
      .where(where(filter))
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .executeTakeFirstOrThrow()
    return Number(row.count)
  },

  async find(db: Executor, id: string) {
    return selectPublications(db).where('p.id', '=', id).executeTakeFirst()
  },

  /** Содержимое отдельно от карточки: в ленту не выбирается. */
  async content(db: Executor, id: string) {
    const row = await db
      .selectFrom('app.publications')
      .where('id', '=', id)
      .select('content')
      .executeTakeFirst()
    return row?.content ?? null
  },

  /** Родитель обсуждения под блокировкой чтения: запись ждёт снятия и удаления. */
  lockShared(tx: Executor, id: string) {
    return tx
      .selectFrom('app.publications')
      .where('id', '=', id)
      .select(['id', 'title', 'author_id', 'status', 'discussion_enabled'])
      .forShare()
      .executeTakeFirst()
  },

  /** Строка под блокировкой правки (одна правка за раз, `FOR UPDATE`). */
  async lock(tx: Executor, id: string) {
    return tx
      .selectFrom('app.publications')
      .where('id', '=', id)
      .select(['id', 'author_id', 'status', 'updated_at', 'published_at'])
      .forUpdate()
      .executeTakeFirst()
  },

  async create(
    tx: Executor,
    values: PublicationValues & { authorId: string; now: string },
  ) {
    const row = await tx
      .insertInto('app.publications')
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
    values: PublicationValues & { now: string; publishedAt: string | null },
  ) {
    await tx
      .updateTable('app.publications')
      .set({
        ...toColumns(values),
        updated_at: values.now,
        published_at: values.publishedAt,
      })
      .where('id', '=', id)
      .execute()
  },

  /** Снятие с публикации — в черновики (решение исполнителя этапа 8). */
  async unpublish(tx: Executor, id: string, now: string) {
    await tx
      .updateTable('app.publications')
      .set({ status: 'draft', updated_at: now })
      .where('id', '=', id)
      .execute()
  },

  async delete(tx: Executor, id: string) {
    await tx.deleteFrom('app.publications').where('id', '=', id).execute()
  },

  async attachments(db: Executor, publicationIds: string[]) {
    if (publicationIds.length === 0) {
      return []
    }
    return db
      .selectFrom('app.publication_attachments')
      .where('publication_id', 'in', publicationIds)
      .select([
        'publication_id',
        'path',
        'file_name',
        'size',
        'content_type',
        'position',
      ])
      .orderBy('publication_id')
      .orderBy('position')
      .execute()
  },

  /** Первое вложение каждой публикации — обложка карточки. */
  async covers(db: Executor, publicationIds: string[]) {
    if (publicationIds.length === 0) {
      return []
    }
    return db
      .selectFrom('app.publication_attachments')
      .where('publication_id', 'in', publicationIds)
      .where('position', '=', 0)
      .select(['publication_id', 'path'])
      .execute()
  },

  /** Какие из путей уже привязаны и к каким публикациям. */
  async owners(db: Executor, paths: string[]) {
    if (paths.length === 0) {
      return []
    }
    return db
      .selectFrom('app.publication_attachments')
      .where('path', 'in', paths)
      .select(['path', 'publication_id'])
      .execute()
  },

  /** Заменяет вложения публикации списком по порядку. */
  async replaceAttachments(
    tx: Executor,
    publicationId: string,
    files: {
      path: string
      fileName: string
      size: number
      contentType: string
    }[],
  ) {
    await tx
      .deleteFrom('app.publication_attachments')
      .where('publication_id', '=', publicationId)
      .execute()
    if (files.length === 0) {
      return
    }
    await tx
      .insertInto('app.publication_attachments')
      .values(
        files.map((file, position) => ({
          publication_id: publicationId,
          path: file.path,
          file_name: file.fileName,
          size: file.size,
          content_type: file.contentType,
          position,
        })),
      )
      .execute()
  },
}

function toColumns(values: PublicationValues) {
  return {
    category: values.category,
    title: values.title,
    summary: values.summary,
    content: values.content as unknown as NonNullable<Json>,
    search_text: values.searchText,
    excerpt: values.excerpt,
    cover_url: values.coverUrl,
    status: values.status,
    show_author: values.showAuthor,
    discussion_enabled: values.discussionEnabled,
  }
}
