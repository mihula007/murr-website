import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AccessProvider, type AccessRole } from '@/app/access'
import { createAppRouter } from '@/app/router'
import { writeLastActivity } from '@/app/splash/splash-timing'

/**
 * Рендерит всё приложение с ролью `role` на адресе `path`. Свежая метка
 * активности отключает заставку, если не передан `splash: true`.
 */
export async function renderApp({
  role = 'guest',
  path = '/',
  splash = false,
}: { role?: AccessRole; path?: string; splash?: boolean } = {}) {
  localStorage.clear()
  if (!splash) {
    writeLastActivity(Date.now())
  }
  const router = createAppRouter(
    createMemoryHistory({ initialEntries: [path] }),
  )
  const result = render(
    <QueryClientProvider client={new QueryClient()}>
      <AccessProvider role={role}>
        <RouterProvider router={router} />
      </AccessProvider>
    </QueryClientProvider>,
  )
  await router.load()
  return { ...result, router }
}
