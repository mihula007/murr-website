import { Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import type { EventDetails } from '@contracts/events'
import { ErrorState } from '@/components/states/error-state'
import { LoadingState } from '@/components/states/loading-state'
import { PageHeader } from '@/components/states/page-header'
import { linkButtonClass } from '@/components/ui/button'
import { Card } from '@/components/ui/surfaces'
import { cn } from '@/lib/utils'
import { useEvent } from './api'
import { EventDiscussion } from './event-discussion'
import {
  EventActions,
  EventAnswers,
  EventBadges,
  EventStart,
  eventAuthor,
} from './event-card'
import { EventGroupCount, EventGroupsSection } from './groups/event-groups'

/** Участники и группы события (GRP). */
function GroupsAndDiscussion({
  event,
  classIds,
  onClassIdsChange,
  groupToolbarTarget,
  eventToolbarTarget,
}: {
  event: EventDetails
  classIds: number[]
  onClassIdsChange: (ids: number[]) => void
  groupToolbarTarget: HTMLDivElement | null
  eventToolbarTarget: HTMLDivElement | null
}) {
  return (
    <EventGroupsSection
      event={event}
      classIds={classIds}
      onClassIdsChange={onClassIdsChange}
      groupToolbarTarget={groupToolbarTarget}
      eventToolbarTarget={eventToolbarTarget}
    />
  )
}

/**
 * Компактная шапка, ответ участника и обсуждение события (EVT-04, DSC-01).
 * Ссылки уведомлений об упоминаниях и ответах продолжают вести сюда.
 */
function EventOverview({
  event,
  onDeleted,
  onGroupToolbarTarget,
  onEventToolbarTarget,
}: {
  event: EventDetails
  onDeleted: () => void
  onGroupToolbarTarget: (target: HTMLDivElement | null) => void
  onEventToolbarTarget: (target: HTMLDivElement | null) => void
}) {
  return (
    <div className="mb-2 grid items-start gap-x-4 gap-y-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.2fr)_minmax(300px,380px)]">
      <header className="order-1 grid min-w-0 gap-3 lg:flex lg:flex-col lg:self-stretch">
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
        <div
          ref={onGroupToolbarTarget}
          className="my-auto flex w-full max-w-[23rem] flex-wrap justify-start gap-1.5 lg:justify-end"
        />
      </header>
      <div className="order-2 grid min-w-0 content-start gap-3 lg:order-3 lg:self-stretch lg:grid-rows-[auto_minmax(0,1fr)]">
        <Card className="grid gap-2 p-3">
          <EventAnswers event={event} />
        </Card>
        <div className="grid min-h-24 content-center justify-items-center gap-2 lg:min-h-0">
          <EventGroupCount event={event} />
          <div ref={onEventToolbarTarget} className="grid justify-items-center" />
        </div>
      </div>
      <div className="order-3 min-w-0 lg:order-2">
        <EventDiscussion
          thread={{ parent: 'event', parentId: event.id }}
          title={event.title}
          messageCount={event.messageCount}
        />
      </div>
    </div>
  )
}

/** Страница события: шапка с ответом, участники и группы (EVT-06, GRP). */
export function EventPage({
  id,
  classIds,
  onClassIdsChange,
}: {
  id: string
  classIds: number[]
  onClassIdsChange: (ids: number[]) => void
}) {
  const navigate = useNavigate()
  const event = useEvent(id)
  const [groupToolbarTarget, setGroupToolbarTarget] = useState<
    HTMLDivElement | null
  >(null)
  const [eventToolbarTarget, setEventToolbarTarget] = useState<
    HTMLDivElement | null
  >(null)

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
          onGroupToolbarTarget={setGroupToolbarTarget}
          onEventToolbarTarget={setEventToolbarTarget}
          onDeleted={() =>
            void navigate({ to: '/events', search: { tab: 'active' } })
          }
        />
        <GroupsAndDiscussion
          event={data}
          classIds={classIds}
          onClassIdsChange={onClassIdsChange}
          groupToolbarTarget={groupToolbarTarget}
          eventToolbarTarget={eventToolbarTarget}
        />
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
