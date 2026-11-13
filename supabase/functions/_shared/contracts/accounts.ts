import { z } from 'zod'
import type { AccessRole, ApplicationStatus } from './account.ts'
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

/** Сортировки таблицы «Аккаунты» (ADM-02); направление — отдельно. */
export const ACCOUNT_SORTS = [
  'nickname',
  'name',
  'class',
  'email',
  'role',
  'registered',
  'joined',
] as const
export type AccountSort = (typeof ACCOUNT_SORTS)[number]
export const SORT_DIRECTIONS = ['asc', 'desc'] as const
export type SortDirection = (typeof SORT_DIRECTIONS)[number]

export const ACCOUNT_LIMITS = {
  search: 100,
  /** Пароль Auth: как в регистрации; 72 байта — предел bcrypt. */
  passwordMin: 8,
  passwordMax: 72,
} as const

/** Строка таблицы «Аккаунты» — только для администратора (ADM-01, ADM-04). */
export type AccountListItem = {
  id: string
  gameNickname: string
  displayName: string
  email: string
  className: string
  role: AccessRole
  registeredAt: string
  joinedOn: string | null
  /** Статус последней заявки; нет заявки — null (ADM-01). */
  applicationStatus: ApplicationStatus | null
  /** Основного администратора нельзя понизить (ACL-07). */
  isPrimaryAdmin: boolean
  /** Роль кандидата с активной заявкой меняется только решением по заявке. */
  hasActiveApplication: boolean
  /** Идёт безвозвратное удаление: действия над аккаунтом закрыты. */
  deletionPending: boolean
}

/** Страница таблицы: поиск и сортировка — на сервере (реестр списков). */
export const accountsListSchema = z.object({
  ...pageRequestShape,
  search: z
    .string()
    .trim()
    .max(ACCOUNT_LIMITS.search, 'too_long')
    .nullish()
    .transform((value) => value || null),
  sort: z.enum(ACCOUNT_SORTS).default('nickname'),
  direction: z.enum(SORT_DIRECTIONS).default('asc'),
})
export type AccountsListRequest = z.input<typeof accountsListSchema>
export type AccountsListResponse = Page<AccountListItem> & {
  /** Число аккаунтов по текущему поиску (ADM-01). */
  total: number
}

export const accountIdSchema = z.object({ userId: z.guid('not_found') })
export type AccountIdRequest = z.input<typeof accountIdSchema>

/** Раскрытая карточка аккаунта (ADM-03): все данные, только администратору. */
export type AccountCard = AccountListItem & {
  city: string | null
  birthDate: string | null
  about: string | null
  avatarUrl: string | null
  /** Ссылки последней заявки на скриншоты; сервер их не запрашивает. */
  equipmentLinks: string[]
  /** У аккаунта задан пароль входа. */
  passwordSet: boolean
}

export const setPasswordSchema = z.object({
  userId: z.guid('not_found'),
  password: z
    .string('required')
    .min(ACCOUNT_LIMITS.passwordMin, 'password_short')
    .max(ACCOUNT_LIMITS.passwordMax, 'too_long'),
})
export type SetPasswordRequest = z.input<typeof setPasswordSchema>
export type SetPasswordResult = { userId: string }

/** Результат смены роли, блокировки или восстановления: без закрытых полей. */
export type RoleChangeResult = {
  userId: string
  role: AccessRole
  joinedOn: string | null
}

/** Этапы безвозвратного удаления: файлы → БД → Auth (проект удаления). */
export const DELETION_STAGES = ['files', 'database', 'auth'] as const
export type DeletionStage = (typeof DELETION_STAGES)[number]

/**
 * Начать или продолжить удаление (Q-73, Q-74). Ник цели вводится для
 * подтверждения безвозвратного действия.
 */
export const deleteAccountSchema = z.object({
  userId: z.guid('not_found'),
  confirmNickname: z.string('required').trim().min(1, 'required').max(40),
})
export type DeleteAccountRequest = z.input<typeof deleteAccountSchema>
export type DeleteAccountResult = { userId: string }

/** Незавершённое удаление — для повтора администратором. */
export type PendingDeletion = {
  userId: string
  nickname: string
  email: string
  stage: DeletionStage
  lastError: string | null
  createdAt: string
  updatedAt: string
}

export type PendingDeletionsResponse = {
  items: PendingDeletion[]
  truncated: boolean
}
