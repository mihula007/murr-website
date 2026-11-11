/** Ключи кеша голосований: решения по заявкам сбрасывают префикс `all`. */
export const voteKeys = {
  all: ['votes'] as const,
  lists: ['votes', 'list'] as const,
  active: ['votes', 'list', 'active'] as const,
  history: ['votes', 'list', 'history'] as const,
  detail: (id: string) => ['votes', 'detail', id] as const,
}
