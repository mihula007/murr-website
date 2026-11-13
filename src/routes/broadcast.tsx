import type { ReactNode } from 'react'
import { createRoute } from '@tanstack/react-router'
import { sectionRoles } from '@/app/navigation'
import { RouteGate } from '@/components/route-gate'
import {
  BroadcastPage,
  broadcastSearchSchema,
} from '@/features/broadcast/broadcast-page'
import { rootRoute } from './root'

const roles = sectionRoles('broadcast')

function BroadcastRoute(): ReactNode {
  const search = broadcastRoute.useSearch()
  return (
    <RouteGate roles={roles}>
      <BroadcastPage {...search} />
    </RouteGate>
  )
}

export const broadcastRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/broadcast',
  validateSearch: broadcastSearchSchema,
  component: BroadcastRoute,
})
