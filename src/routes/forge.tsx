import type { ReactNode } from 'react'
import { createRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { INTERNAL_ROLES } from '@/app/access'
import { RouteGate } from '@/components/route-gate'
import { ForgeCalculatorPage } from '@/features/forge/forge-calculator-page'
import { rootRoute } from './root'

function ForgeRoute(): ReactNode {
  const { calculator } = forgeRoute.useParams()
  const search = forgeRoute.useSearch()
  const navigate = forgeRoute.useNavigate()
  return (
    <RouteGate roles={INTERNAL_ROLES}>
      <ForgeCalculatorPage
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
