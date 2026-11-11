import { createRootRoute } from '@tanstack/react-router'
import { RootLayout } from '@/app/shell/root-layout'
import { NotFoundPage } from '@/features/not-found/not-found-page'

export const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFoundPage,
})
