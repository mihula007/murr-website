import { createRoute } from '@tanstack/react-router'
import { NAV_SECTIONS, type NavSectionConfig } from '@/app/navigation'
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
      <RouteGate roles={section.roles}>
        <SectionPlaceholder section={section} />
      </RouteGate>
    ),
  })
}

export const sectionRoutes = NAV_SECTIONS.map(createSectionRoute)
