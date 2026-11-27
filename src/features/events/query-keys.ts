/** Ключи кеша событий: другие модули сбрасывают префикс `all`. */
export const eventKeys = {
  all: ['events'] as const,
  lists: ['events', 'list'] as const,
  active: ['events', 'list', 'active'] as const,
  past: ['events', 'list', 'past'] as const,
  detail: (id: string) => ['events', 'detail', id] as const,
  templates: ['events', 'templates'] as const,
  groupTemplates: ['events', 'group-templates'] as const,
  groupTemplateCatalog: ['events', 'group-template-catalog'] as const,
  groupTemplate: (id: string) => ['events', 'group-template', id] as const,
  groupPool: (input: {
    eventId: string
    tab: string
    classIds: number[]
    sortBy: string | null
    direction: string
  }) => ['events', 'group-pool', input] as const,
  groupPoolAll: ['events', 'group-pool'] as const,
}
