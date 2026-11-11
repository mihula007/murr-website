import type { ReactNode } from 'react'
import { createRoute } from '@tanstack/react-router'
import { MANAGER_ROLES } from '@/app/access'
import { sectionRoles } from '@/app/navigation'
import { RouteGate } from '@/components/route-gate'
import {
  CreateEventPage,
  EditEventPage,
} from '@/features/events/event-form-page'
import { EventPage } from '@/features/events/event-page'
import { EventsPage, eventsSearchSchema } from '@/features/events/events-page'
import { rootRoute } from './root'

const roles = sectionRoles('events')

function EventsRoute(): ReactNode {
  const search = eventsRoute.useSearch()
  return (
    <RouteGate roles={roles}>
      <EventsPage {...search} />
    </RouteGate>
  )
}

function EventRoute(): ReactNode {
  const { id } = eventRoute.useParams()
  return (
    <RouteGate roles={roles}>
      <EventPage key={id} id={id} />
    </RouteGate>
  )
}

function EditEventRoute(): ReactNode {
  const { id } = editEventRoute.useParams()
  return (
    <RouteGate roles={MANAGER_ROLES}>
      <EditEventPage key={id} id={id} />
    </RouteGate>
  )
}

export const eventsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/events',
  validateSearch: eventsSearchSchema,
  component: EventsRoute,
})

// Создают события и шаблоны только офицеры и администраторы (EVT-03).
export const createEventRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/events/new',
  component: () => (
    <RouteGate roles={MANAGER_ROLES}>
      <CreateEventPage />
    </RouteGate>
  ),
})

export const eventRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/events/$id',
  component: EventRoute,
})

export const editEventRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/events/$id/edit',
  component: EditEventRoute,
})
