import type { AccessRole } from './contracts/account.ts'

/** Роли текущего состава и внутреннего доступа (ACL-01, ROS-01). */
export const INTERNAL_ROLES = [
  'member',
  'officer',
  'admin',
] as const satisfies readonly AccessRole[]

export function isInternalRole(role: AccessRole) {
  return (INTERNAL_ROLES as readonly AccessRole[]).includes(role)
}

/** Дата по Москве (UTC+3, Q-08) для даты вступления. */
export function moscowDate(now: Date) {
  return new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/**
 * Дата вступления после смены роли — единственное место этого правила.
 * Переход кандидата или чтеца во внутреннюю роль (приём, восстановление,
 * смена роли администратором) ставит сегодняшнюю дату (APP-09, ACL-06).
 * Переходы между внутренними ролями и блокировка дату не меняют: история
 * сохраняется.
 */
export function joinedOnAfterRoleChange(
  previous: AccessRole,
  next: AccessRole,
  current: string | null,
  today: string,
): string | null {
  return !isInternalRole(previous) && isInternalRole(next) ? today : current
}
