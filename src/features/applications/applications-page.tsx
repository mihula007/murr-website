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
import { Button } from '@/components/ui/button'
import { NavBadge } from '@/components/ui/nav-badge'
import { Badge } from '@/components/ui/surfaces'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { APPLICATION_STATUS } from '@/features/account/status-labels'
import { formatDate } from '@/lib/format-date'
import { useApplicationList } from './api'

/** Параметры адреса очереди: неизвестные значения дают первую страницу «Новых». */
export const applicationsSearchSchema = z.object({
  tab: z.enum(APPLICATION_TABS).catch('new'),
  page: z.number().int().min(0).catch(0),
})
export type ApplicationsSearch = z.output<typeof applicationsSearchSchema>

/** Карточка очереди по образцу `.officer-application-card` прототипа. */
function QueueCard({ item }: { item: ApplicationListItem }) {
  const { applicant } = item
  return (
    <li>
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
            {applicant.className} · подана {formatDate(item.submittedAt)}
            {item.decidedAt ? ` · решение ${formatDate(item.decidedAt)}` : ''}
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
    </li>
  )
}

/** Очередь заявок офицера и администратора (APP-03, APP-04). */
// Типы поиска TanStack Router в компоненте маршрута необязательны: значения
// по умолчанию — те же, что у схемы.
export function ApplicationsPage({
  tab = 'new',
  page = 0,
}: Partial<ApplicationsSearch>) {
  const navigate = useNavigate()
  const list = useApplicationList(tab, page)
  const go = (search: ApplicationsSearch) =>
    void navigate({ to: '/applications', search })

  let content
  if (list.isPending) {
    content = <LoadingState label="Загружаем заявки…" />
  } else if (list.isError) {
    content = <ErrorState onRetry={() => void list.refetch()} />
  } else if (list.data.items.length === 0) {
    content = (
      <EmptyState
        title={tab === 'new' ? 'Новых заявок нет' : 'Решённых заявок нет'}
        description={
          tab === 'new'
            ? 'Когда кандидат подаст заявку, она появится здесь.'
            : 'Здесь появятся принятые и отклонённые заявки.'
        }
      />
    )
  } else {
    content = (
      <ul className="m-0 grid list-none gap-2 p-0">
        {list.data.items.map((item) => (
          <QueueCard key={item.id} item={item} />
        ))}
      </ul>
    )
  }

  const hasPages = tab === 'decided' && (page > 0 || list.data?.hasMore)

  return (
    <section>
      <PageHeader
        eyebrow="Управление"
        title="Заявки"
        description="Проверка анкет кандидатов: приём в клан или отказ."
      />
      <Tabs
        value={tab}
        onValueChange={(value) =>
          go({ tab: value === 'decided' ? 'decided' : 'new', page: 0 })
        }
      >
        <TabsList aria-label="Заявки" className="mb-4">
          <TabsTrigger value="new" className="inline-flex items-center gap-2">
            Новые
            <NavBadge count={list.data?.newCount} />
          </TabsTrigger>
          <TabsTrigger value="decided">Решённые</TabsTrigger>
        </TabsList>
      </Tabs>
      {content}
      {hasPages ? (
        <nav
          aria-label="Страницы решённых заявок"
          className="mt-4 flex flex-wrap items-center justify-between gap-3"
        >
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={page === 0}
            onClick={() => go({ tab, page: page - 1 })}
          >
            Новее
          </Button>
          <span className="text-sm text-muted-foreground">
            Страница {page + 1}
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!list.data?.hasMore}
            onClick={() => go({ tab, page: page + 1 })}
          >
            Старше
          </Button>
        </nav>
      ) : null}
    </section>
  )
}
