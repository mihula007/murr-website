/** Ключи кеша торговых объявлений: другие модули сбрасывают префикс `all`. */
export const marketKeys = {
  all: ['market'] as const,
  lists: ['market', 'list'] as const,
  list: (request: object) => ['market', 'list', request] as const,
  detail: (id: string) => ['market', 'detail', id] as const,
}
