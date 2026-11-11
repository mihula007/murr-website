/** Ключи кеша состава: решения по заявкам и смена ролей сбрасывают их префикс `all`. */
export const rosterKeys = {
  all: ['roster'] as const,
  count: ['roster', 'count'] as const,
  stats: ['roster', 'stats'] as const,
  /** Весь текущий состав (Q-48). */
  list: ['roster', 'list'] as const,
  readers: ['roster', 'readers'] as const,
}
