/** Ключи кеша уведомлений и счётчиков разделов (NTF). */
export const notificationKeys = {
  all: ['notifications'] as const,
  summary: ['notifications', 'summary'] as const,
  list: ['notifications', 'list'] as const,
}
