/** Ключи кеша состава: решения по заявкам и смена ролей сбрасывают их префикс `all`. */
export const rosterKeys = {
  all: ['roster'] as const,
  count: ['roster', 'count'] as const,
  stats: ['roster', 'stats'] as const,
  /** Весь текущий состав (Q-48). */
  list: ['roster', 'list'] as const,
  page: (filters: { classIds: number[] }) =>
    ['roster', 'page', filters] as const,
  templatePage: (filters: { classId: number | null; search: string }) =>
    ['roster', 'template-page', filters] as const,
  readers: ['roster', 'readers'] as const,
  dynamics: (userId: string, period: string, fields: string[]) =>
    ['roster', 'dynamics', userId, period, fields] as const,
}
