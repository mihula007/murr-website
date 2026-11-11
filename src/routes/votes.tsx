import type { ReactNode } from 'react'
import { createRoute } from '@tanstack/react-router'
import { MANAGER_ROLES } from '@/app/access'
import { sectionRoles } from '@/app/navigation'
import { RouteGate } from '@/components/route-gate'
import { CreateVotePage } from '@/features/votes/create-vote-page'
import { VotePage } from '@/features/votes/vote-page'
import { VotesPage, votesSearchSchema } from '@/features/votes/votes-page'
import { rootRoute } from './root'

const roles = sectionRoles('votes')

function VotesRoute(): ReactNode {
  const search = votesRoute.useSearch()
  return (
    <RouteGate roles={roles}>
      <VotesPage {...search} />
    </RouteGate>
  )
}

function VoteRoute(): ReactNode {
  const { id } = voteRoute.useParams()
  return (
    <RouteGate roles={roles}>
      <VotePage key={id} id={id} />
    </RouteGate>
  )
}

export const votesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/votes',
  validateSearch: votesSearchSchema,
  component: VotesRoute,
})

// Создают голосования только офицеры и администраторы (VOT-02).
export const createVoteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/votes/new',
  component: () => (
    <RouteGate roles={MANAGER_ROLES}>
      <CreateVotePage />
    </RouteGate>
  ),
})

export const voteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/votes/$id',
  component: VoteRoute,
})
