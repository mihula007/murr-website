import type { Decorator } from '@storybook/react-vite'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'

/** Оборачивает историю в маршрутизатор в памяти, чтобы работали `Link`. */
export const withRouter: Decorator = (Story) => {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => <Story /> }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  return <RouterProvider router={router} />
}
