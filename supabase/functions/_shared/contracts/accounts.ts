import { z } from 'zod'
import type { AccessRole } from './account.ts'
import { pageRequestShape, type Page } from './paging.ts'

export const ACCESS_ROLES = [
  'applicant',
  'reader',
  'member',
  'officer',
  'admin',
] as const satisfies readonly AccessRole[]

export const setRoleSchema = z.object({
  userId: z.guid('not_found'),
  role: z.enum(ACCESS_ROLES),
})
export type SetRoleRequest = z.input<typeof setRoleSchema>

export const restoreReaderSchema = z.object({ userId: z.guid('not_found') })
export type RestoreReaderRequest = z.input<typeof restoreReaderSchema>

/** Строка таблицы «Аккаунты» — только для администратора (ADM-04). */
export type AccountListItem = {
  id: string
  gameNickname: string
  displayName: string
  email: string
  role: AccessRole
  joinedOn: string | null
  /** Основного администратора нельзя понизить (ACL-07). */
  isPrimaryAdmin: boolean
  /** Роль кандидата с активной заявкой меняется только решением по заявке. */
  hasActiveApplication: boolean
}

/** Страница таблицы «Аккаунты» по нику. */
export const accountsListSchema = z.object(pageRequestShape)
export type AccountsListRequest = z.input<typeof accountsListSchema>
export type AccountsListResponse = Page<AccountListItem>

/** Результат смены роли, блокировки или восстановления: без закрытых полей. */
export type RoleChangeResult = {
  userId: string
  role: AccessRole
  joinedOn: string | null
}
