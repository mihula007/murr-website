import type { Decorator } from '@storybook/react-vite'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'

/**
 * Оборачивает историю в маршрутизатор в памяти, чтобы работали `Link`.
 * История открывается на `/story`, поэтому ссылки на `/` — настоящий переход
 * (нужно, например, для демо защиты от потери данных).
 */
export const withRouter: Decorator = (Story) => {
  const rootRoute = createRootRoute({ component: () => <Story /> })
  const anyPath = createRoute({
    getParentRoute: () => rootRoute,
    path: '$',
    component: () => null,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([anyPath]),
    history: createMemoryHistory({ initialEntries: ['/story'] }),
  })
  return <RouterProvider router={router} />
}
