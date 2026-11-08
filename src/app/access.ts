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
