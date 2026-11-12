import type { AccessRole } from '@/app/access'

/** Ключи кеша раздела материалов (лежат в его модуле: `query-keys.ts`). */
export type MaterialKeys = {
  all: readonly unknown[]
  lists: readonly unknown[]
  list: (request: object) => readonly unknown[]
  detail: (id: string) => readonly unknown[]
}

/**
 * Раздел материалов с общим редактором: публикации (PUB) или рынок (MKT).
 * Права проверяет сервер; здесь — только адреса, тексты и роли меню.
 */
export type MaterialSection<C extends string = string> = {
  /** Префикс операций `api` и маршрутов. */
  kind: 'publications' | 'market'
  path: '/publications' | '/market'
  keys: MaterialKeys
  categories: readonly C[]
  categoryLabels: Record<C, string>
  /** Кто видит кнопку создания (сервер всё равно проверяет). */
  creators: readonly AccessRole[]
  /** Вложения-файлы есть только у публикаций (MKT-08). */
  withFiles: boolean
  /** Флаг скрытия подписи есть только у публикаций (MKT-03). */
  withAuthorToggle: boolean
  texts: {
    eyebrow: string
    title: string
    description: string
    create: string
    newTitle: string
    editTitle: string
    item: string
    emptyPublished: string
    emptyDrafts: string
    deleteDescription: string
  }
}
