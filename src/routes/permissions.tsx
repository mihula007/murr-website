import { createRoute } from '@tanstack/react-router'
import { RouteGate } from '@/components/route-gate'
import { OfficerPermissionsPage } from '@/features/officer-permissions/permissions-page'
import { rootRoute } from './root'

/** «Мастерка» доступна Мастеру и Администратору (OFP-01). */
export const permissionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/permissions',
  component: () => (
    <RouteGate roles={['master', 'admin']}>
      <OfficerPermissionsPage />
    </RouteGate>
  ),
})
