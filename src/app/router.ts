import {
  createHashHistory,
  createRoute,
  createRouter,
  lazyRouteComponent,
  type RouterHistory,
} from '@tanstack/react-router'
import { RouteError, rootRoute } from '@/routes/root'
import { indexRoute } from '@/routes/index'
import { accountRoute } from '@/routes/account'
import { sectionRoutes } from '@/routes/sections'

// Демо защиты от потери данных: условие по константе DEV вырезает маршрут
// и его модуль из production-сборки.
const devRoutes = import.meta.env.DEV
  ? [
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/dev/unsaved-demo',
        component: lazyRouteComponent(
          () => import('@/routes/dev-unsaved-demo'),
        ),
      }),
    ]
  : []

export const routeTree = rootRoute.addChildren([
  indexRoute,
  accountRoute,
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
