import type { z } from 'zod'
import type { Page } from '../contracts/paging.ts'
import { ApiError } from './errors.ts'

/**
 * Курсор keyset-пагинации — base64url JSON ключа последней строки страницы
 * (ключ сортировки и `id`). Клиент передаёт его обратно без изменений.
 */
export function encodeCursor(key: readonly unknown[]): string {
  let binary = ''
  for (const byte of new TextEncoder().encode(JSON.stringify(key))) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

/** Ключ из курсора по схеме списка; испорченный курсор — ошибка поля. */
export function decodeCursor<T extends z.ZodType>(
  schema: T,
  cursor: string,
): z.output<T> {
  let value: unknown
  try {
    const binary = atob(cursor.replaceAll('-', '+').replaceAll('_', '/'))
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    value = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new ApiError('validation_failed', { cursor: 'invalid' })
  }
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new ApiError('validation_failed', { cursor: 'invalid' })
  }
  return result.data as z.output<T>
}

/**
 * Делит строки, выбранные с `limit + 1`: лишняя строка означает, что дальше
 * есть ещё, а курсор строится по последней показанной.
 */
export function splitPage<Row>(
  rows: Row[],
  limit: number,
  keyOf: (row: Row) => readonly unknown[],
): { rows: Row[]; nextCursor: Page<Row>['nextCursor'] } {
  const last = rows[limit - 1]
  return {
    rows: rows.slice(0, limit),
    nextCursor: rows.length > limit && last ? encodeCursor(keyOf(last)) : null,
  }
}
