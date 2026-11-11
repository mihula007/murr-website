import { createRoute } from '@tanstack/react-router'
import { HomePage } from '@/features/home/home-page'
import { rootRoute } from './root'

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomePage,
})
