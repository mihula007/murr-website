import {
  createHashHistory,
  createRouter,
  type RouterHistory,
} from '@tanstack/react-router'
import { RouteError, rootRoute } from '@/routes/root'
import { indexRoute } from '@/routes/index'
import { accountRoute } from '@/routes/account'
import { sectionRoutes } from '@/routes/sections'

export const routeTree = rootRoute.addChildren([
  indexRoute,
  accountRoute,
  ...sectionRoutes,
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
