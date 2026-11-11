import type { ReactNode } from 'react'
import { createRoute } from '@tanstack/react-router'
import { NAV_SECTIONS } from '@/app/navigation'
import { RouteGate } from '@/components/route-gate'
import { ApplicationPage } from '@/features/applications/application-page'
import {
  ApplicationsPage,
  applicationsSearchSchema,
} from '@/features/applications/applications-page'
import { rootRoute } from './root'

const section = NAV_SECTIONS.find((item) => item.id === 'applications')
if (!section) throw new Error('Нет раздела «Заявки» в навигации')
const { roles } = section

function ApplicationsRoute(): ReactNode {
  const search = applicationsRoute.useSearch()
  return (
    <RouteGate roles={roles}>
      <ApplicationsPage {...search} />
    </RouteGate>
  )
}

function ApplicationRoute(): ReactNode {
  const { id } = applicationRoute.useParams()
  return (
    <RouteGate roles={roles}>
      <ApplicationPage key={id} id={id} />
    </RouteGate>
  )
}

export const applicationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/applications',
  validateSearch: applicationsSearchSchema,
  component: ApplicationsRoute,
})

export const applicationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/applications/$id',
  component: ApplicationRoute,
})
