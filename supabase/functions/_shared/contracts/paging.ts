import { z } from 'zod'

/**
 * Порог малого списка (AGENTS.md, раздел «Списки»): список, который по
 * ответу владельца не превышает этого числа, отдаётся целиком.
 */
export const SMALL_LIST_LIMIT = 50

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
