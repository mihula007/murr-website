import type { ReactNode } from 'react'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { render } from '@testing-library/react'

/** Рендерит элемент на маршруте `path` в памяти; остальные пути — пустые страницы. */
export async function renderWithRouter(
  ui: ReactNode,
  {
    path = '/',
    extraPaths = ['/account'],
  }: { path?: string; extraPaths?: string[] } = {},
) {
  const rootRoute = createRootRoute({ component: Outlet })
  const routes = [path, ...extraPaths.filter((p) => p !== path), '/'].filter(
    (value, index, all) => all.indexOf(value) === index,
  )
  const router = createRouter({
    routeTree: rootRoute.addChildren(
      routes.map((routePath) =>
        createRoute({
          getParentRoute: () => rootRoute,
          path: routePath,
          component: () => (routePath === path ? ui : <p>{routePath}</p>),
        }),
      ),
    ),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  const result = render(<RouterProvider router={router} />)
  await router.load()
  return { ...result, router }
}
