/** Ключи кеша публикаций: другие модули сбрасывают префикс `all`. */
export const publicationKeys = {
  all: ['publications'] as const,
  lists: ['publications', 'list'] as const,
  list: (request: object) => ['publications', 'list', request] as const,
  detail: (id: string) => ['publications', 'detail', id] as const,
}
