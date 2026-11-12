import {
  createHashHistory,
  createRoute,
  createRouter,
  lazyRouteComponent,
  type RouterHistory,
} from '@tanstack/react-router'
import { RouteError } from '@/components/states/route-error'
import { rootRoute } from '@/routes/root'
import { indexRoute } from '@/routes/index'
import { accountRoute, resubmitRoute } from '@/routes/account'
import { activityRoute, ratingRoute } from '@/routes/activity'
import { applicationRoute, applicationsRoute } from '@/routes/applications'
import { adminRoute } from '@/routes/admin'
import { authRoutes } from '@/routes/auth'
import {
  createListingRoute,
  editListingRoute,
  listingRoute,
  marketRoute,
} from '@/routes/market'
import {
  createPublicationRoute,
  editPublicationRoute,
  publicationRoute,
  publicationsRoute,
} from '@/routes/publications'
import { rosterRoute } from '@/routes/roster'
import { sectionRoutes } from '@/routes/sections'
import { createVoteRoute, voteRoute, votesRoute } from '@/routes/votes'
import {
  createEventRoute,
  editEventRoute,
  eventRoute,
  eventsRoute,
} from '@/routes/events'

// Демо защиты от потери данных: условие по константе DEV вырезает маршрут
// и его модуль из production-сборки.
const devRoutes = import.meta.env.DEV
  ? [
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/dev/unsaved-demo',
        component: lazyRouteComponent(
          () => import('@/features/dev/unsaved-demo-page'),
        ),
      }),
    ]
  : []

export const routeTree = rootRoute.addChildren([
  indexRoute,
  accountRoute,
  resubmitRoute,
  applicationsRoute,
  applicationRoute,
  rosterRoute,
  adminRoute,
  votesRoute,
  createVoteRoute,
  voteRoute,
  eventsRoute,
  createEventRoute,
  eventRoute,
  editEventRoute,
  activityRoute,
  ratingRoute,
  publicationsRoute,
  createPublicationRoute,
  publicationRoute,
  editPublicationRoute,
  marketRoute,
  createListingRoute,
  listingRoute,
  editListingRoute,
  ...authRoutes,
  ...sectionRoutes,
  ...devRoutes,
])

/** `history` подменяется в тестах на историю в памяти. */
export function createAppRouter(history: RouterHistory = createHashHistory()) {
  return createRouter({
    routeTree,
    history,
    defaultPreload: 'intent',
    scrollRestoration: true,
    defaultErrorComponent: RouteError,
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>
  }
}
