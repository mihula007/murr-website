import { Link, useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { z } from 'zod'
import { VOTE_TABS } from '@contracts/votes'
import { SMALL_LIST_LIMIT } from '@contracts/paging'
import { hasRole, MANAGER_ROLES, useAccess } from '@/app/access'
import { EmptyState } from '@/components/states/empty-state'
import { ErrorState } from '@/components/states/error-state'
import { LoadingState } from '@/components/states/loading-state'
import { PageHeader } from '@/components/states/page-header'
import { buttonVariants } from '@/components/ui/button'
import { NavBadge } from '@/components/ui/nav-badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { pagingOf, VirtualList } from '@/components/virtual-list'
import { useActiveVotes, useVoteHistory } from './api'
import { VoteCard } from './vote-card'

/** Параметры адреса: неизвестная вкладка — «Актуальные». */
export const votesSearchSchema = z.object({
  tab: z.enum(VOTE_TABS).catch('active'),
})
export type VotesSearch = z.output<typeof votesSearchSchema>

/** Сетка карточек: 1 колонка на узком экране, 2 — от 900 px. */
const gridClass = 'grid-cols-1 min-[900px]:grid-cols-2'

const EMPTY = {
  active: {
    title: 'Активных голосований нет',
    description: 'Новые голосования появятся здесь.',
  },
  history: {
    title: 'История пуста',
    description: 'Здесь появятся завершённые голосования.',
  },
} as const

/** Раздел «Голосование»: актуальные и история (VOT-01). */
// Типы поиска TanStack Router в компоненте маршрута необязательны: значения
// по умолчанию — те же, что у схемы.
export function VotesPage({ tab = 'active' }: Partial<VotesSearch>) {
  const navigate = useNavigate()
  const { role } = useAccess()
  // Счётчик актуальных нужен на обеих вкладках: список малый и кэшируется.
  const active = useActiveVotes()
  const history = useVoteHistory(tab === 'history')
  const historyItems = history.data?.pages.flatMap((page) => page.items)
  const list = tab === 'active' ? active : history

  let content
  if (list.isPending) {
    content = <LoadingState label="Загружаем голосования…" />
  } else if (list.isError) {
    content = <ErrorState onRetry={() => void list.refetch()} />
  } else if (tab === 'active' && active.data) {
    content =
      active.data.items.length === 0 ? (
        <EmptyState {...EMPTY.active} />
      ) : (
        <>
          <ul
            aria-label="Актуальные голосования"
            className={`m-0 grid list-none gap-3 p-0 ${gridClass}`}
          >
            {active.data.items.map((vote) => (
              <li key={vote.id} className="min-w-0">
                <VoteCard vote={vote} linkToPage className="h-full" />
              </li>
            ))}
          </ul>
          {active.data.truncated ? (
            <output className="mt-3 block text-sm text-muted-foreground">
              Показаны {SMALL_LIST_LIMIT} последних голосований. Завершите
              старые, чтобы увидеть остальные.
            </output>
          ) : null}
        </>
      )
  } else if (!historyItems || historyItems.length === 0) {
    content = <EmptyState {...EMPTY.history} />
  } else {
    content = (
      <VirtualList
        label="История голосований"
        items={historyItems}
        getKey={(vote) => vote.id}
        estimateSize={320}
        columns={1}
        gap="md"
        paging={pagingOf(history)}
        renderItem={(vote) => <VoteCard vote={vote} linkToPage />}
      />
    )
  }

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader
          title="Голосование"
          description="Решения клана: голосуйте и меняйте решение, пока голосование открыто."
        />
        {hasRole(role, MANAGER_ROLES) ? (
          <Link
            to="/votes/new"
            className={buttonVariants({ className: 'mb-4 no-underline' })}
          >
            <Plus size={18} aria-hidden="true" /> Создать голосование
          </Link>
        ) : null}
      </div>
      <Tabs
        value={tab}
        onValueChange={(value) =>
          void navigate({
            to: '/votes',
            search: { tab: value === 'history' ? 'history' : 'active' },
          })
        }
      >
        <TabsList aria-label="Голосования" className="mb-4">
          <TabsTrigger
            value="active"
            className="inline-flex items-center gap-2"
          >
            Актуальные
            <NavBadge count={active.data?.activeCount} />
          </TabsTrigger>
          <TabsTrigger value="history">История</TabsTrigger>
        </TabsList>
      </Tabs>
      {content}
    </section>
  )
}
