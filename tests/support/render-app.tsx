import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { render } from '@testing-library/react'
import { AccessProvider, type AccessRole } from '@/app/access'
import { createAppRouter } from '@/app/router'

/** Рендерит всё приложение с ролью `role` на адресе `path`. */
export async function renderApp({
  role = 'guest',
  path = '/',
}: { role?: AccessRole; path?: string } = {}) {
  const router = createAppRouter(
    createMemoryHistory({ initialEntries: [path] }),
  )
  const result = render(
    <AccessProvider role={role}>
      <RouterProvider router={router} />
    </AccessProvider>,
  )
  await router.load()
  return { ...result, router }
}
