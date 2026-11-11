/** Ключи кеша состава: решения по заявкам и смена ролей сбрасывают их префикс `all`. */
export const rosterKeys = {
  all: ['roster'] as const,
  count: ['roster', 'count'] as const,
  stats: ['roster', 'stats'] as const,
  /** Страницы состава с фильтром класса (`null` — все классы). */
  list: (classId: number | null) => ['roster', 'list', classId] as const,
  readers: ['roster', 'readers'] as const,
}
