import { createHashHistory, createRouter } from '@tanstack/react-router'
import { rootRoute } from '@/routes/root'
import { indexRoute } from '@/routes/index'
import { accountRoute } from '@/routes/account'

const routeTree = rootRoute.addChildren([indexRoute, accountRoute])

export function createAppRouter() {
  return createRouter({
    routeTree,
    history: createHashHistory(),
    defaultPreload: 'intent',
    scrollRestoration: true,
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>
  }
}
