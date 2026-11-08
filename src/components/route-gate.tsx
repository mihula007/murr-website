import type { PropsWithChildren } from 'react'
import { hasRole, useAccess, type AccessRole } from '@/app/access'
import { ForbiddenState } from '@/components/states/forbidden-state'

type RouteGateProps = PropsWithChildren<{ roles: readonly AccessRole[] }>

/**
 * Клиентская проверка доступа к маршруту. Роли берутся из той же таблицы, что
 * и меню. Это не защита данных: на этапе 3 её дополняют RLS и проверки сервера.
 */
export function RouteGate({ roles, children }: RouteGateProps) {
  const { role } = useAccess()
  if (!hasRole(role, roles)) return <ForbiddenState accessRole={role} />
  return children
}
