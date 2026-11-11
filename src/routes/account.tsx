import { createRoute } from '@tanstack/react-router'
import { AccountPage } from '@/features/account/account-page'
import { ResubmitPage } from '@/features/applications/resubmit-page'
import { rootRoute } from './root'

export const accountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/account',
  component: AccountPage,
})

export const resubmitRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/account/application',
  component: ResubmitPage,
})
