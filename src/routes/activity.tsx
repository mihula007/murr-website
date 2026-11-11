import type { ReactNode } from 'react'
import { createRoute } from '@tanstack/react-router'
import { sectionRoles } from '@/app/navigation'
import { RouteGate } from '@/components/route-gate'
import {
  ActivityPage,
  activitySearchSchema,
} from '@/features/activity/activity-page'
import { RatingPage } from '@/features/activity/rating-page'
import { rootRoute } from './root'

function ActivityRoute(): ReactNode {
  const search = activityRoute.useSearch()
  return (
    <RouteGate roles={sectionRoles('activity')}>
      <ActivityPage {...search} />
    </RouteGate>
  )
}

/** «Учёт активности» — офицер и администратор (01-roles, Q-25). */
export const activityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/activity',
  validateSearch: activitySearchSchema,
  component: ActivityRoute,
})

/** «Рейтинг посещения» — все внутренние роли (ACT-14). */
export const ratingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/rating',
  component: () => (
    <RouteGate roles={sectionRoles('rating')}>
      <RatingPage />
    </RouteGate>
  ),
})
