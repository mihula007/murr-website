import { createRoute } from '@tanstack/react-router'
import {
  NAV_SECTIONS,
  sectionPermissionMode,
  sectionPermissions,
  type NavSectionConfig,
} from '@/app/navigation'
import { RouteGate } from '@/components/route-gate'
import { SectionPlaceholder } from '@/features/sections/section-placeholder'
import { rootRoute } from './root'

function createSectionRoute<const TSection extends NavSectionConfig>(
  section: TSection,
) {
  return createRoute({
    getParentRoute: () => rootRoute,
    path: section.path,
    component: () => (
      <RouteGate
        roles={section.roles}
        permissions={sectionPermissions(section.id)}
        permissionMode={sectionPermissionMode(section.id) ?? 'all'}
      >
        <SectionPlaceholder section={section} />
      </RouteGate>
    ),
  })
}

/** Разделы, у которых уже есть свои маршруты; остальные — заглушки. */
const IMPLEMENTED: readonly string[] = [
  'applications',
  'roster',
  'admin',
  'votes',
  'events',
  'kh',
  'activity',
  'rating',
  'publications',
  'market',
  'broadcast',
  'permissions',
  'gods',
  'rings',
  'robe',
  'equipment',
  'night-weapon',
  'chienkun',
  'titles',
]

export const sectionRoutes = NAV_SECTIONS.filter(
  (section) => !IMPLEMENTED.includes(section.id),
).map(createSectionRoute)
