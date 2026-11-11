import { createRoute } from '@tanstack/react-router'
import { sectionRoles } from '@/app/navigation'
import { RouteGate } from '@/components/route-gate'
import { RosterPage } from '@/features/roster/roster-page'
import { rootRoute } from './root'

const roles = sectionRoles('roster')

export const rosterRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/roster',
  component: () => (
    <RouteGate roles={roles}>
      <RosterPage />
    </RouteGate>
  ),
})
