import { Hammer } from 'lucide-react'
import type { NavSectionConfig } from '@/app/navigation'
import { EmptyState } from '@/components/states/empty-state'
import { PageHeader } from '@/components/states/page-header'

/** Заглушка раздела, который появится на следующих этапах. */
export function SectionPlaceholder({ section }: { section: NavSectionConfig }) {
  return (
    <section>
      <PageHeader title={section.label} />
      <EmptyState
        icon={<Hammer size={22} />}
        title="Раздел в разработке"
        description="Содержимое этого раздела появится на следующих этапах."
      />
    </section>
  )
}
