import { createRoute } from '@tanstack/react-router'
import { INTERNAL_ROLES } from '@/app/access'
import { RouteGate } from '@/components/route-gate'
import { KhQueuesPage } from '@/features/kh-queues/kh-queues-page'
import { rootRoute } from './root'

function KhRoute() {
  return (
    <RouteGate roles={INTERNAL_ROLES}>
      <KhQueuesPage />
    </RouteGate>
  )
}

export const khRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/kh',
  component: KhRoute,
})
