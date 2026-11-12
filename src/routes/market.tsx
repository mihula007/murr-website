import type { ReactNode } from 'react'
import { createRoute } from '@tanstack/react-router'
import { sectionRoles } from '@/app/navigation'
import { RouteGate } from '@/components/route-gate'
import { MaterialEditorPage } from '@/features/content/material-editor-page'
import {
  MaterialFeedPage,
  materialSearchSchema,
} from '@/features/content/material-feed-page'
import { MaterialPage } from '@/features/content/material-page'
import { marketSection } from '@/features/market/section'
import { rootRoute } from './root'

// Читают и создают объявления член, офицер и администратор (MKT-01, Q-04).
const traders = sectionRoles('market')

function FeedRoute(): ReactNode {
  const search = marketRoute.useSearch()
  return (
    <RouteGate roles={traders}>
      <MaterialFeedPage section={marketSection} search={search} />
    </RouteGate>
  )
}

function DetailRoute(): ReactNode {
  const { id } = listingRoute.useParams()
  return (
    <RouteGate roles={traders}>
      <MaterialPage key={id} section={marketSection} id={id} />
    </RouteGate>
  )
}

function EditRoute(): ReactNode {
  const { id } = editListingRoute.useParams()
  return (
    <RouteGate roles={traders}>
      <MaterialEditorPage key={id} section={marketSection} id={id} />
    </RouteGate>
  )
}

export const marketRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/market',
  validateSearch: materialSearchSchema,
  component: FeedRoute,
})

export const createListingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/market/new',
  component: () => (
    <RouteGate roles={traders}>
      <MaterialEditorPage section={marketSection} />
    </RouteGate>
  ),
})

export const listingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/market/$id',
  component: DetailRoute,
})

export const editListingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/market/$id/edit',
  component: EditRoute,
})
