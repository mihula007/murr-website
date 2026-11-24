import type { ReactNode } from 'react'
import { createRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { ACCESS_ROLES, useAccess } from '@/app/access'
import { ErrorState } from '@/components/states/error-state'
import { RouteGate } from '@/components/route-gate'
import { SectionPlaceholder } from '@/features/sections/section-placeholder'
import { ForgeCalculatorPage } from '@/features/forge/forge-calculator-page'
import { NAV_SECTIONS } from '@/app/navigation'
import { rootRoute } from './root'

function ForgeRouteContent({
  calculator,
  search,
  slot,
  onSearchChange,
  onSlotChange,
}: {
  calculator: string
  search: string
  slot: string
  onSearchChange: (value: string) => void
  onSlotChange: (value: string) => void
}): ReactNode {
  const { role } = useAccess()
  const section = NAV_SECTIONS.find(
    (candidate) => candidate.path === `/forge/${calculator}`,
  )
  if (!section) {
    return <ErrorState title="Раздел не найден" />
  }
  if (role !== 'admin') {
    return <SectionPlaceholder section={section} />
  }
  return (
    <ForgeCalculatorPage
      calculator={calculator}
      search={search}
      slot={slot}
      onSearchChange={onSearchChange}
      onSlotChange={onSlotChange}
    />
  )
}

function ForgeRoute(): ReactNode {
  const { calculator } = forgeRoute.useParams()
  const search = forgeRoute.useSearch()
  const navigate = forgeRoute.useNavigate()
  return (
    <RouteGate roles={ACCESS_ROLES}>
      <ForgeRouteContent
        calculator={calculator}
        search={search.search}
        slot={search.slot ?? ''}
        onSearchChange={(value) =>
          void navigate({
            search: (previous) => ({ ...previous, search: value }),
          })
        }
        onSlotChange={(slot) =>
          void navigate({
            search: (previous) => ({ ...previous, slot: slot || undefined }),
          })
        }
      />
    </RouteGate>
  )
}

export const forgeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/forge/$calculator',
  validateSearch: z.object({
    search: z.string().max(120).catch(''),
    slot: z.string().optional().catch(undefined),
  }),
  component: ForgeRoute,
})
