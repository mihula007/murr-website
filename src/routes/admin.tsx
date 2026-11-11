import { createRoute } from '@tanstack/react-router'
import { sectionRoles } from '@/app/navigation'
import { RouteGate } from '@/components/route-gate'
import { AdminPage } from '@/features/admin/admin-page'
import { rootRoute } from './root'

const roles = sectionRoles('admin')

export const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin',
  component: () => (
    <RouteGate roles={roles}>
      <AdminPage />
    </RouteGate>
  ),
})
