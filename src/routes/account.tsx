import { createRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { AccountPage } from '@/features/account/account-page'
import { ResubmitPage } from '@/features/applications/resubmit-page'
import { rootRoute } from './root'

const accountSearchSchema = z.object({
  section: z.enum(['messengers']).optional(),
})

function AccountRoute() {
  const search = accountRoute.useSearch()
  return <AccountPage focusMessenger={search.section === 'messengers'} />
}

export const accountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/account',
  validateSearch: accountSearchSchema,
  component: AccountRoute,
})

export const resubmitRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/account/application',
  component: ResubmitPage,
})
