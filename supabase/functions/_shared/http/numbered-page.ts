import { NUMBERED_PAGE_SIZE, type NumberedPage } from '../contracts/paging.ts'

/** Смещение и размер выборки для номера страницы (Q-55). */
export function pageWindow(page: number) {
  return { offset: (page - 1) * NUMBERED_PAGE_SIZE, limit: NUMBERED_PAGE_SIZE }
}

/** Ответ нумерованной страницы по строкам и общему числу записей. */
export function numberedPage<T>(
  items: T[],
  total: number,
  page: number,
): NumberedPage<T> {
  return {
    items,
    page,
    pageCount: Math.max(1, Math.ceil(total / NUMBERED_PAGE_SIZE)),
    total,
  }
}
