import { z } from 'zod'
import { numberedPageRequestShape, type NumberedPage } from './paging.ts'
import { richDocumentSchema, type RichDocument } from './rich-text.ts'

/**
 * Общие поля материалов из общего редактора: публикаций (PUB) и торговых
 * объявлений (MKT). Права у разделов разные и проверяются их сервисами.
 */
export const MATERIAL_LIMITS = {
  title: 120,
  summary: 300,
  /** Краткий текст карточки, если анонса нет. */
  excerpt: 200,
  search: 100,
} as const

export const MATERIAL_STATUSES = ['draft', 'published'] as const
export type MaterialStatus = (typeof MATERIAL_STATUSES)[number]

/** «Опубликованные» — нумерованные страницы (Q-55), «Черновики» — до 50. */
export const MATERIAL_TABS = ['published', 'drafts'] as const
export type MaterialTab = (typeof MATERIAL_TABS)[number]

const requiredText = (max: number) =>
  z.string().trim().min(1, 'required').max(max, 'too_long')

/** Запрос ленты раздела с его категориями. */
export function listMaterialsSchema<
  const C extends readonly [string, ...string[]],
>(categories: C) {
  return z.object({
    tab: z.enum(MATERIAL_TABS).default('published'),
    ...numberedPageRequestShape,
    category: z
      .enum(categories)
      .nullish()
      .transform((value) => value ?? null),
    search: z
      .string()
      .trim()
      .max(MATERIAL_LIMITS.search, 'too_long')
      .nullish()
      .transform((value) => value || null),
  })
}

/** Общие поля сохранения: создание без `id`, правка с `id` и версией. */
export function saveMaterialShape<
  const C extends readonly [string, ...string[]],
>(categories: C) {
  return {
    id: z
      .guid()
      .nullish()
      .transform((value) => value ?? null),
    /** `updatedAt` открытой версии: другая — `state_conflict`. */
    expectedUpdatedAt: z.string().max(64).nullish(),
    status: z.enum(MATERIAL_STATUSES),
    category: z.enum(categories),
    title: requiredText(MATERIAL_LIMITS.title),
    summary: z
      .string()
      .trim()
      .max(MATERIAL_LIMITS.summary, 'too_long')
      .nullish()
      .transform((value) => value || null),
    content: richDocumentSchema,
    discussionEnabled: z.boolean(),
  }
}

export const materialIdSchema = z.object({ id: z.guid() })

/**
 * Подпись автора: показана, автор удалён (PUB-17, MKT-12) или скрыта от
 * читателя флагом публикации (PUB-07) — тогда `null`.
 */
export type MaterialAuthor =
  { state: 'shown'; gameNickname: string } | { state: 'deleted' } | null

export type MaterialCard<C extends string> = {
  id: string
  category: C
  title: string
  summary: string | null
  excerpt: string
  /** Первое изображение: вложение (подписанная ссылка) или по URL. */
  coverUrl: string | null
  status: MaterialStatus
  updatedAt: string
  author: MaterialAuthor
  discussionEnabled: boolean
  /** Сообщений в обсуждении (PUB-08, MKT-10, DSC-01). */
  messageCount?: number
}

export type MaterialDetails<C extends string> = MaterialCard<C> & {
  content: RichDocument
  createdAt: string
  publishedAt: string | null
  /** Может править, публиковать, снимать и удалять (PUB-06, MKT-06/07). */
  canManage: boolean
}

/**
 * Ответ ленты: опубликованные — нумерованная страница (Q-55); черновики —
 * все доступные до `SMALL_LIST_LIMIT` на одной странице и `truncated`.
 */
export type MaterialListResponse<C extends string> = NumberedPage<
  MaterialCard<C>
> & {
  truncated: boolean
  /** Можно создавать и видеть вкладку «Черновики». */
  canCreate: boolean
}
