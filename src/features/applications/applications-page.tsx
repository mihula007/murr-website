import { Link, useNavigate } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { z } from 'zod'
import {
  APPLICATION_TABS,
  type ApplicationListItem,
} from '@contracts/applications'
import { EmptyState } from '@/components/states/empty-state'
import { ErrorState } from '@/components/states/error-state'
import { LoadingState } from '@/components/states/loading-state'
import { PageHeader } from '@/components/states/page-header'
import { Avatar } from '@/components/ui/avatar'
import { NavBadge } from '@/components/ui/nav-badge'
import { Badge } from '@/components/ui/surfaces'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { pagingOf, VirtualList } from '@/components/virtual-list'
import { APPLICATION_STATUS } from '@/features/account/status-labels'
import { SMALL_LIST_LIMIT } from '@contracts/paging'
import { formatDateMsk } from '@/lib/format-date'
import { useDecidedApplications, useNewApplications } from './api'

/** Параметры адреса очереди: неизвестная вкладка — «Новые». */
export const applicationsSearchSchema = z.object({
  tab: z.enum(APPLICATION_TABS).catch('new'),
})
export type ApplicationsSearch = z.output<typeof applicationsSearchSchema>

/** Карточка очереди по образцу `.officer-application-card` прототипа. */
function QueueCard({ item }: { item: ApplicationListItem }) {
  const { applicant } = item
  return (
    <Link
      to="/applications/$id"
      params={{ id: item.id }}
      className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-surface-inset p-3.5 no-underline transition-colors hover:border-border-accent focus-visible:border-ring focus-visible:outline-none"
    >
      <Avatar
        size="sm"
        name={applicant.gameNickname}
        src={applicant.avatarUrl}
        alt=""
      />
      <span className="grid min-w-0 flex-1 gap-0.5">
        <strong className="break-words text-foreground">
          {applicant.gameNickname}
        </strong>
        <small className="text-muted-foreground">
          {applicant.className} · подана {formatDateMsk(item.submittedAt)}
          {item.decidedAt ? ` · решение ${formatDateMsk(item.decidedAt)}` : ''}
        </small>
      </span>
      {item.status !== 'pending_officer_review' ? (
        <Badge className="max-sm:hidden">
          {APPLICATION_STATUS[item.status].label}
        </Badge>
      ) : null}
      <ChevronRight
        size={18}
        aria-hidden="true"
        className="flex-none text-muted-foreground"
      />
    </Link>
  )
}

const EMPTY = {
  new: {
    title: 'Новых заявок нет',
    description: 'Когда кандидат подаст заявку, она появится здесь.',
  },
  decided: {
    title: 'Решённых заявок нет',
    description: 'Здесь появятся принятые и отклонённые заявки.',
  },
} as const

/**
 * «Новые» — малый список (≤ 50 по ответу владельца): целиком, без
 * виртуализации. Если заявок всё же больше, сервер отдаёт самые старые и
 * признак `truncated` — интерфейс сообщает об этом, а не обрезает молча.
 */
function SmallQueue({
  label,
  items,
  truncated,
}: {
  label: string
  items: ApplicationListItem[]
  truncated: boolean
}) {
  return (
    <>
      <ul aria-label={label} className="m-0 grid list-none gap-2 p-0">
        {items.map((item) => (
          <li key={item.id}>
            <QueueCard item={item} />
          </li>
        ))}
      </ul>
      {truncated ? (
        <output className="mt-3 block text-sm text-muted-foreground">
          Показаны {SMALL_LIST_LIMIT} самых старых заявок. Остальные появятся
          здесь после решения по показанным.
        </output>
      ) : null}
    </>
  )
}

/** Очередь заявок офицера и администратора (APP-03, APP-04). */
// Типы поиска TanStack Router в компоненте маршрута необязательны: значения
// по умолчанию — те же, что у схемы.
export function ApplicationsPage({
  tab: requested = 'new',
}: Partial<ApplicationsSearch>) {
  const navigate = useNavigate()
  const tab = requested
  const newQueue = useNewApplications(tab === 'new')
  const decided = useDecidedApplications(tab === 'decided')
  const decidedItems = decided.data?.pages.flatMap((page) => page.items)
  const counts = tab === 'new' ? newQueue.data : decided.data?.pages[0]
  const small = newQueue
  const list = tab === 'decided' ? decided : small

  let content
  if (list.isPending) {
    content = <LoadingState label="Загружаем заявки…" />
  } else if (list.isError) {
    content = <ErrorState onRetry={() => void list.refetch()} />
  } else if (tab !== 'decided' && small.data) {
    content =
      small.data.items.length === 0 ? (
        <EmptyState {...EMPTY[tab]} />
      ) : (
        <SmallQueue
          label="Новые заявки"
          items={small.data.items}
          truncated={small.data.truncated}
        />
      )
  } else if (!decidedItems || decidedItems.length === 0) {
    content = <EmptyState {...EMPTY.decided} />
  } else {
    content = (
      <VirtualList
        label="Решённые заявки"
        items={decidedItems}
        getKey={(item) => item.id}
        estimateSize={70}
        paging={pagingOf(decided)}
        renderItem={(item) => <QueueCard item={item} />}
      />
    )
  }

  return (
    <section>
      <PageHeader
        title="Заявки"
        description="Проверка анкет кандидатов: голосование, приём в клан или отказ."
      />
      <Tabs
        value={tab}
        onValueChange={(value) =>
          void navigate({
            to: '/applications',
            search: {
              tab: value === 'decided' ? value : 'new',
            },
          })
        }
      >
        <TabsList aria-label="Заявки" className="mb-4">
          <TabsTrigger value="new" className="inline-flex items-center gap-2">
            Новые
            <NavBadge count={counts?.newCount} />
          </TabsTrigger>
          <TabsTrigger value="decided">Решённые</TabsTrigger>
        </TabsList>
      </Tabs>
      {content}
    </section>
  )
}
