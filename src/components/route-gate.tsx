import type { PropsWithChildren } from 'react'
import type { OfficerPermissionCode } from '@contracts/officer-permissions'
import { hasRole, useAccess, type AccessRole } from '@/app/access'
import { ErrorState } from '@/components/states/error-state'
import { ForbiddenState } from '@/components/states/forbidden-state'
import { LoadingState } from '@/components/states/loading-state'

type RouteGateProps = PropsWithChildren<{
  roles: readonly AccessRole[]
  permissions?: readonly OfficerPermissionCode[]
  permissionMode?: 'all' | 'any'
}>

/**
 * Клиентская проверка доступа к маршруту. Роли берутся из той же таблицы, что
 * и меню. Это не защита данных: права проверяют сервисы Edge Functions.
 */
export function RouteGate({
  roles,
  permissions = [],
  permissionMode = 'all',
  children,
}: RouteGateProps) {
  const { role, status, retry, hasOfficerPermission } = useAccess()
  if (status === 'loading') {
    return <LoadingState label="Проверяем доступ…" />
  }
  if (status === 'error') {
    return (
      <ErrorState
        message="Не удалось загрузить профиль. Попробуйте ещё раз."
        {...(retry ? { onRetry: retry } : {})}
      />
    )
  }
  const hasRequiredPermissions =
    permissions.length === 0 ||
    (permissionMode === 'any'
      ? permissions.some(hasOfficerPermission)
      : permissions.every(hasOfficerPermission))
  if (!hasRole(role, roles) || !hasRequiredPermissions) {
    return <ForbiddenState accessRole={role} />
  }
  return children
}
