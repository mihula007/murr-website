import { createRoute } from '@tanstack/react-router'
import { Hammer } from 'lucide-react'
import {
  NAV_CATEGORIES,
  NAV_SECTIONS,
  type NavSectionConfig,
} from '@/app/navigation'
import { RouteGate } from '@/components/route-gate'
import { EmptyState } from '@/components/states/empty-state'
import { PageHeader } from '@/components/states/page-header'
import { rootRoute } from './root'

function SectionPlaceholder({ section }: { section: NavSectionConfig }) {
  const category = NAV_CATEGORIES.find((item) => item.id === section.category)
  return (
    <section>
      <PageHeader eyebrow={category?.label} title={section.label} />
      <EmptyState
        icon={<Hammer size={22} />}
        title="Раздел в разработке"
        description="Содержимое этого раздела появится на следующих этапах."
      />
    </section>
  )
}

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
