import { Hammer } from 'lucide-react'
import { NAV_CATEGORIES, type NavSectionConfig } from '@/app/navigation'
import { EmptyState } from '@/components/states/empty-state'
import { PageHeader } from '@/components/states/page-header'

/** Заглушка раздела, который появится на следующих этапах. */
export function SectionPlaceholder({ section }: { section: NavSectionConfig }) {
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
