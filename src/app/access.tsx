import {
  createContext,
  useContext,
  useMemo,
  type PropsWithChildren,
} from 'react'
import { useSession } from '@/features/auth/session'
import { useMe } from '@/features/auth/use-me'

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

/**
 * `loading` — сессия или профиль ещё загружаются; `incomplete` — вошёл, но
 * регистрация не завершена (права гостя); `error` — профиль не загрузился.
 */
export type AccessStatus =
  'loading' | 'guest' | 'incomplete' | 'ready' | 'error'

type AccessContextValue = {
  role: AccessRole
  status: AccessStatus
  retry?: () => void
}

const AccessContext = createContext<AccessContextValue>({
  role: 'guest',
  status: 'guest',
})

type AccessProviderProps = PropsWithChildren<{
  /** Фиксированная роль для тестов и историй. */
  role?: AccessRole
}>

function SessionAccess({ children }: PropsWithChildren) {
  const session = useSession()
  const me = useMe()
  const value = useMemo<AccessContextValue>(() => {
    if (session.status === 'loading')
      return { role: 'guest', status: 'loading' }
    if (session.status !== 'signedIn') return { role: 'guest', status: 'guest' }
    if (me.isPending) return { role: 'guest', status: 'loading' }
    if (me.isError || !me.data) {
      return { role: 'guest', status: 'error', retry: () => void me.refetch() }
    }
    if (me.data.state === 'incomplete') {
      return { role: 'guest', status: 'incomplete' }
    }
    return { role: me.data.profile.role, status: 'ready' }
  }, [session.status, me])
  return <AccessContext value={value}>{children}</AccessContext>
}

/**
 * Текущая роль. Источник — профиль с сервера (`account/me`), а не JWT или
 * Auth metadata. Это клиентская проверка для меню и маршрутов; права данных
 * проверяют сервисы Edge Functions.
 */
export function AccessProvider({ role, children }: AccessProviderProps) {
  if (role) {
    return (
      <AccessContext
        value={{ role, status: role === 'guest' ? 'guest' : 'ready' }}
      >
        {children}
      </AccessContext>
    )
  }
  return <SessionAccess>{children}</SessionAccess>
}

export function useAccess() {
  return useContext(AccessContext)
}
