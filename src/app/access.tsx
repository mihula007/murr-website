import {
  createContext,
  useContext,
  useMemo,
  type PropsWithChildren,
} from 'react'
import { useSession } from '@/features/auth/session'
import { useMe } from '@/features/account/use-me'
import {
  OFFICER_PERMISSION_CODES,
  type OfficerPermissionCode,
} from '@contracts/officer-permissions'

export type AccessRole =
  'guest' | 'applicant' | 'reader' | 'member' | 'officer' | 'master' | 'admin'

export const ACCESS_ROLES: readonly AccessRole[] = [
  'guest',
  'applicant',
  'reader',
  'member',
  'officer',
  'master',
  'admin',
]
export const INTERNAL_ROLES: readonly AccessRole[] = [
  'member',
  'officer',
  'master',
  'admin',
]
export const MANAGER_ROLES: readonly AccessRole[] = [
  'officer',
  'master',
  'admin',
]
export const ADMIN_ROLES: readonly AccessRole[] = ['admin']

export const ROLE_LABELS: Record<AccessRole, string> = {
  guest: 'Гость',
  applicant: 'Кандидат',
  reader: 'Чтец',
  member: 'Член клана',
  officer: 'Офицер',
  master: 'Мастер',
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
  officerPermissions: readonly OfficerPermissionCode[]
  hasOfficerPermission: (permission: OfficerPermissionCode) => boolean
  nickname?: string
  retry?: () => void
}

const AccessContext = createContext<AccessContextValue>({
  role: 'guest',
  status: 'guest',
  officerPermissions: [],
  hasOfficerPermission: () => false,
})

type AccessProviderProps = PropsWithChildren<{
  /** Фиксированная роль для тестов и историй. */
  role?: AccessRole
  /** Фиксированные права для тестов и историй. */
  officerPermissions?: readonly OfficerPermissionCode[]
}>

function SessionAccess({ children }: PropsWithChildren) {
  const session = useSession()
  const me = useMe()
  const value = useMemo<AccessContextValue>(() => {
    if (session.status === 'loading') {
      return {
        role: 'guest',
        status: 'loading',
        officerPermissions: [],
        hasOfficerPermission: () => false,
      }
    }
    if (session.status !== 'signedIn') {
      return {
        role: 'guest',
        status: 'guest',
        officerPermissions: [],
        hasOfficerPermission: () => false,
      }
    }
    if (me.isPending) {
      return {
        role: 'guest',
        status: 'loading',
        officerPermissions: [],
        hasOfficerPermission: () => false,
      }
    }
    if (me.isError || !me.data) {
      return {
        role: 'guest',
        status: 'error',
        officerPermissions: [],
        hasOfficerPermission: () => false,
        retry: () => void me.refetch(),
      }
    }
    const data = me.data
    if (data.state === 'incomplete') {
      return {
        role: 'guest',
        status: 'incomplete',
        officerPermissions: [],
        hasOfficerPermission: () => false,
      }
    }
    return {
      role: data.profile.role,
      status: 'ready',
      officerPermissions: data.officerPermissions ?? [],
      hasOfficerPermission: (permission) =>
        data.profile.role === 'master' ||
        data.profile.role === 'admin' ||
        (data.profile.role === 'officer' &&
          data.officerPermissions?.includes(permission) === true),
      nickname: data.profile.gameNickname,
    }
  }, [session.status, me])
  return <AccessContext value={value}>{children}</AccessContext>
}

/**
 * Текущая роль. Источник — профиль с сервера (`account/me`), а не JWT или
 * Auth metadata. Это клиентская проверка для меню и маршрутов; права данных
 * проверяют сервисы Edge Functions.
 */
export function AccessProvider({
  role,
  officerPermissions,
  children,
}: AccessProviderProps) {
  if (role) {
    const permissions =
      officerPermissions ?? (role === 'officer' ? OFFICER_PERMISSION_CODES : [])
    return (
      <AccessContext
        value={{
          role,
          status: role === 'guest' ? 'guest' : 'ready',
          officerPermissions: permissions,
          hasOfficerPermission: (permission) =>
            role === 'master' ||
            role === 'admin' ||
            (role === 'officer' && permissions.includes(permission)),
        }}
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
