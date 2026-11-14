/** Ключи кеша заявок: голосования по заявкам сбрасывают префикс `all`. */
export const applicationKeys = {
  all: ['applications'] as const,
  lists: ['applications', 'list'] as const,
  newQueue: ['applications', 'list', 'new'] as const,
  decided: ['applications', 'list', 'decided'] as const,
  detail: (id: string) => ['applications', 'detail', id] as const,
}
