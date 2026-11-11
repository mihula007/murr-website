/** Ключи кеша событий: другие модули сбрасывают префикс `all`. */
export const eventKeys = {
  all: ['events'] as const,
  lists: ['events', 'list'] as const,
  active: ['events', 'list', 'active'] as const,
  past: ['events', 'list', 'past'] as const,
  detail: (id: string) => ['events', 'detail', id] as const,
  templates: ['events', 'templates'] as const,
}
