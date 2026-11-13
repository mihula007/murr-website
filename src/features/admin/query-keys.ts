import type { AccountSort, SortDirection } from '@contracts/accounts'
import type { AuditCategory } from '@contracts/audit'

export type AccountsQuery = {
  search: string
  sort: AccountSort
  direction: SortDirection
}

export type AuditQuery = { category: AuditCategory | null; search: string }

/** Ключи кеша администрирования: аккаунты, карточка, удаления, журнал. */
export const accountKeys = {
  all: ['accounts'] as const,
  lists: ['accounts', 'list'] as const,
  list: (query: AccountsQuery) => ['accounts', 'list', query] as const,
  card: (userId: string) => ['accounts', 'card', userId] as const,
  deletions: ['accounts', 'deletions'] as const,
}

export const auditKeys = {
  all: ['audit'] as const,
  list: (query: AuditQuery) => ['audit', 'list', query] as const,
}
