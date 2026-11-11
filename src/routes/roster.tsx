import type { ReactNode } from 'react'
import { createRoute } from '@tanstack/react-router'
import { sectionRoles } from '@/app/navigation'
import { RouteGate } from '@/components/route-gate'
import { RosterPage, rosterSearchSchema } from '@/features/roster/roster-page'
import { rootRoute } from './root'

const roles = sectionRoles('roster')

function RosterRoute(): ReactNode {
  const search = rosterRoute.useSearch()
  return (
    <RouteGate roles={roles}>
      <RosterPage {...search} />
    </RouteGate>
  )
}

export const rosterRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/roster',
  validateSearch: rosterSearchSchema,
  component: RosterRoute,
})
