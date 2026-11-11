/**
 * Ключи кеша учёта активности и рейтинга: закрытие события сбрасывает
 * префикс `all`.
 */
export const activityKeys = {
  all: ['activity'] as const,
  summary: (filters: object) => ['activity', 'summary', filters] as const,
  history: (filters: object) => ['activity', 'history', filters] as const,
  events: (filters: object) => ['activity', 'events', filters] as const,
  event: (id: string, classId: number | null) =>
    ['activity', 'event', id, classId] as const,
  member: (id: string, filters: object) =>
    ['activity', 'member', id, filters] as const,
  rating: ['activity', 'rating'] as const,
  monthTop: ['activity', 'month-top'] as const,
}
