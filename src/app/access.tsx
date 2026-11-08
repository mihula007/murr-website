import {
  createContext,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react'

export type AccessRole =
  'guest' | 'applicant' | 'reader' | 'member' | 'officer' | 'admin'

export const ACCESS_ROLES: readonly AccessRole[] = [
  'guest',
  'applicant',
  'reader',
  'member',
  'officer',
  'admin',
]
export const INTERNAL_ROLES: readonly AccessRole[] = [
  'member',
  'officer',
  'admin',
]
export const MANAGER_ROLES: readonly AccessRole[] = ['officer', 'admin']
export const ADMIN_ROLES: readonly AccessRole[] = ['admin']

export const ROLE_LABELS: Record<AccessRole, string> = {
  guest: 'Гость',
  applicant: 'Кандидат',
  reader: 'Чтец',
  member: 'Член клана',
  officer: 'Офицер',
  admin: 'Администратор',
}

export function hasRole(role: AccessRole, roles: readonly AccessRole[]) {
  return roles.includes(role)
}

type AccessContextValue = {
  role: AccessRole
  /** Есть только в dev-режиме: смена роли из переключателя «Смотреть как…». */
  setRole?: (role: AccessRole) => void
}

const AccessContext = createContext<AccessContextValue>({ role: 'guest' })

function isAccessRole(value: unknown): value is AccessRole {
  return ACCESS_ROLES.includes(value as AccessRole)
}

function readDevRole(): AccessRole {
  try {
    const stored = window.localStorage.getItem('murr-dev-role')
    return isAccessRole(stored) ? stored : 'guest'
  } catch {
    return 'guest'
  }
}

function writeDevRole(role: AccessRole) {
  try {
    window.localStorage.setItem('murr-dev-role', role)
  } catch {
    // Хранилище недоступно: роль действует до перезагрузки.
  }
}

type AccessProviderProps = PropsWithChildren<{
  /** Фиксированная роль для тестов и историй. */
  role?: AccessRole
}>

/**
 * Текущая роль. В production до этапа 3 всегда `guest`; в dev-режиме роль
 * выбирается переключателем и хранится в localStorage. Ветка dev вырезается
 * из production-сборки, потому что `import.meta.env.DEV` — константа.
 */
export function AccessProvider({
  role: fixedRole,
  children,
}: AccessProviderProps) {
  const [devRole, setDevRole] = useState<AccessRole>(() =>
    import.meta.env.DEV ? readDevRole() : 'guest',
  )
  const value = useMemo<AccessContextValue>(() => {
    if (fixedRole) return { role: fixedRole }
    if (!import.meta.env.DEV) return { role: 'guest' }
    return {
      role: devRole,
      setRole: (role) => {
        writeDevRole(role)
        setDevRole(role)
      },
    }
  }, [fixedRole, devRole])
  return <AccessContext value={value}>{children}</AccessContext>
}

export function useAccess() {
  return useContext(AccessContext)
}
