import type { ReactNode } from 'react'
import { createRoute } from '@tanstack/react-router'
import { sectionRoles } from '@/app/navigation'
import { RouteGate } from '@/components/route-gate'
import { AdminPage, adminSearchSchema } from '@/features/admin/admin-page'
import { rootRoute } from './root'

const roles = sectionRoles('admin')

function AdminRoute(): ReactNode {
  const search = adminRoute.useSearch()
  return (
    <RouteGate roles={roles}>
      <AdminPage {...search} />
    </RouteGate>
  )
}

export const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin',
  validateSearch: adminSearchSchema,
  component: AdminRoute,
})
