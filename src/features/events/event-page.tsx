import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import type { EventDetails } from '@contracts/events'
import { ErrorState } from '@/components/states/error-state'
import { LoadingState } from '@/components/states/loading-state'
import { PageHeader } from '@/components/states/page-header'
import { linkButtonClass } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useEvent } from './api'
import {
  EventActions,
  EventBadges,
  EventStart,
  eventAuthor,
} from './event-card'
import { EventGroupsSection } from './groups/event-groups'

/**
 * Участники и группы события (GRP); обсуждение открывается из карточки события.
 */
function GroupsAndDiscussion({ event }: { event: EventDetails }) {
  return <EventGroupsSection event={event} />
}

/**
 * Компактная шапка события. Сводка ответов остаётся в карточке расписания.
 */
function EventOverview({
  event,
  onDeleted,
}: {
  event: EventDetails
  onDeleted: () => void
}) {
  return (
    <div className="mb-4">
      <header className="grid min-w-0 gap-3">
        <div className="flex items-start justify-between gap-3">
          <EventBadges event={event} />
          <EventActions event={event} onDeleted={onDeleted} />
        </div>
        <h1 className="m-0 text-[52px] leading-[1.02] font-bold break-words max-sm:text-[38px]">
          {event.title}
        </h1>
        <EventStart startsAt={event.startsAt} />
        {event.description ? (
          <p className="m-0 max-w-[65ch] break-words whitespace-pre-line text-muted-foreground">
            {event.description}
          </p>
        ) : null}
        <p className="m-0 text-xs text-muted-foreground">
          Автор: {eventAuthor(event)}
        </p>
      </header>
    </div>
  )
}

/** Страница события: шапка с ответом, участники и группы (EVT-06, GRP). */
export function EventPage({ id }: { id: string }) {
  const navigate = useNavigate()
  const event = useEvent(id)

  let content
  if (event.isPending) {
    content = (
      <>
        <PageHeader title="Событие" />
        <LoadingState label="Загружаем событие…" />
      </>
    )
  } else if (event.isError) {
    content = (
      <>
        <PageHeader title="Событие" />
        {event.error.code === 'not_found' ? (
          <ErrorState
            title="Событие не найдено"
            message="Возможно, его удалили или ссылка устарела."
          />
        ) : (
          <ErrorState onRetry={() => void event.refetch()} />
        )}
      </>
    )
  } else {
    const data = event.data
    content = (
      <>
        <EventOverview
          event={data}
          onDeleted={() =>
            void navigate({ to: '/events', search: { tab: 'active' } })
          }
        />
        <GroupsAndDiscussion event={data} />
      </>
    )
  }

  return (
    <section>
      <Link
        to="/events"
        search={{ tab: 'active' }}
        className={cn(linkButtonClass, 'mb-3 inline-flex items-center gap-1.5')}
      >
        <ArrowLeft size={16} aria-hidden="true" /> К событиям
      </Link>
      {content}
    </section>
  )
}
