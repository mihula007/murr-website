import { z } from 'zod'

/**
 * Порог малого списка (AGENTS.md, раздел «Списки»): список, который по
 * ответу владельца не превышает этого числа, отдаётся целиком.
 */
export const SMALL_LIST_LIMIT = 50

/**
 * Страховочный порог списков текущих участников клана (Q-48): их до 200,
 * и они всегда отдаются целиком одним ответом; при превышении порога
 * ответ несёт признак обрезки, а не обрезает молча.
 */
export const MEMBER_LIST_LIMIT = 250

/** Список участников клана целиком; `truncated` — порог превышен. */
export type MemberList<T> = { items: T[]; truncated: boolean }

/** Размер страницы большого списка по умолчанию и максимум запроса. */
export const PAGE_SIZE = 50
export const MAX_PAGE_SIZE = 100

/**
 * Поля запроса страницы большого списка: непрозрачный курсор из
 * `nextCursor` предыдущего ответа (нет — первая страница) и размер.
 */
export const pageRequestShape = {
  cursor: z
    .string()
    .max(512, 'invalid')
    .nullish()
    .transform((value) => value || null),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(PAGE_SIZE),
}

export type PageRequest = {
  cursor?: string | null | undefined
  limit?: number | undefined
}

/** Страница большого списка; `nextCursor: null` — страниц больше нет. */
export type Page<T> = { items: T[]; nextCursor: string | null }

/**
 * Нумерованные страницы — исключение для лент публикаций и рынка (Q-55):
 * номер страницы вместо курсора, размер фиксирован сервером.
 */
export const NUMBERED_PAGE_SIZE = 50

export const numberedPageRequestShape = {
  page: z.number().int().min(1, 'invalid').max(100_000, 'invalid').default(1),
}

/** Страница ленты: `pageCount ≥ 1`, номер за пределами — пустой `items`. */
export type NumberedPage<T> = {
  items: T[]
  page: number
  pageCount: number
  total: number
}
