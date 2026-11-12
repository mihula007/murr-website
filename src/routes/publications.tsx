import type { ReactNode } from 'react'
import { createRoute } from '@tanstack/react-router'
import { MANAGER_ROLES } from '@/app/access'
import { sectionRoles } from '@/app/navigation'
import { RouteGate } from '@/components/route-gate'
import { MaterialEditorPage } from '@/features/content/material-editor-page'
import {
  MaterialFeedPage,
  materialSearchSchema,
} from '@/features/content/material-feed-page'
import { MaterialPage } from '@/features/content/material-page'
import { publicationsSection } from '@/features/publications/section'
import { rootRoute } from './root'

const readers = sectionRoles('publications')

function FeedRoute(): ReactNode {
  const search = publicationsRoute.useSearch()
  return (
    <RouteGate roles={readers}>
      <MaterialFeedPage section={publicationsSection} search={search} />
    </RouteGate>
  )
}

function DetailRoute(): ReactNode {
  const { id } = publicationRoute.useParams()
  return (
    <RouteGate roles={readers}>
      <MaterialPage key={id} section={publicationsSection} id={id} />
    </RouteGate>
  )
}

function EditRoute(): ReactNode {
  const { id } = editPublicationRoute.useParams()
  return (
    <RouteGate roles={MANAGER_ROLES}>
      <MaterialEditorPage key={id} section={publicationsSection} id={id} />
    </RouteGate>
  )
}

export const publicationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/publications',
  validateSearch: materialSearchSchema,
  component: FeedRoute,
})

// Создают публикации офицеры и администраторы (Q-02, ACL-11).
export const createPublicationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/publications/new',
  component: () => (
    <RouteGate roles={MANAGER_ROLES}>
      <MaterialEditorPage section={publicationsSection} />
    </RouteGate>
  ),
})

export const publicationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/publications/$id',
  component: DetailRoute,
})

export const editPublicationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/publications/$id/edit',
  component: EditRoute,
})
