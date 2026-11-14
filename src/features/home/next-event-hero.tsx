import { Link } from '@tanstack/react-router'
import { ArrowRight, CalendarPlus } from 'lucide-react'
import type { EventSummary } from '@contracts/events'
import { MANAGER_ROLES, hasRole, useAccess } from '@/app/access'
import { ErrorState } from '@/components/states/error-state'
import { LoadingState } from '@/components/states/loading-state'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/surfaces'
import { useActiveEvents } from '@/features/events/api'
import {
  EventAnswers,
  EventBadges,
  EventStart,
} from '@/features/events/event-card'
import { useRosterCount } from '@/features/roster/api'
import { eventsLabel, membersLabel } from './plural'

const heroTitleClass =
  'm-0 text-[clamp(42px,5.4vw,68px)] leading-[1.0] font-bold tracking-[-.01em] break-words'

/**
 * Численность и число актуальных событий одной фразой (HOM-07): без плиток,
 * вторым планом под главным событием. Неизвестное число не выводится.
 */
function ClanPulse({ activeCount }: { activeCount: number | undefined }) {
  const members = useRosterCount()
  const parts: string[] = []
  if (members.data !== undefined) {
    parts.push(`${members.data} ${membersLabel(members.data)} в клане`)
  }
  if (activeCount !== undefined) {
    parts.push(`${activeCount} ${eventsLabel(activeCount)}`)
  }
  if (parts.length === 0) {
    return null
  }
  return (
    <p aria-live="polite" className="m-0 text-sm text-muted-foreground">
      {parts.join(', ')}.
    </p>
  )
}

/**
 * Сетка героя: на узком экране — описание, ответ, переходы (ответ важнее
 * навигации); на широком ответ — колонкой справа на всю высоту.
 */
function HeroEvent({ event }: { event: EventSummary }) {
  return (
    <div className="grid items-start gap-x-8 gap-y-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
      <div className="grid min-w-0 content-start gap-3 lg:col-start-1 lg:row-start-1">
        <EventBadges event={event} />
        <h1 className={heroTitleClass}>
          <Link
            to="/events/$id"
            params={{ id: event.id }}
            className="text-foreground no-underline hover:text-highlight"
          >
            {event.title}
          </Link>
        </h1>
        <EventStart startsAt={event.startsAt} />
        {event.description ? (
          <p className="m-0 line-clamp-2 max-w-[60ch] break-words whitespace-pre-line text-muted-foreground">
            {event.description}
          </p>
        ) : null}
      </div>
      <Card className="grid gap-3 p-4 lg:col-start-2 lg:row-span-2 lg:row-start-1">
        <EventAnswers event={event} />
      </Card>
      <div className="flex flex-wrap gap-3 lg:col-start-1 lg:row-start-2">
        <Button asChild>
          <Link to="/events/$id" params={{ id: event.id }}>
            Открыть событие
          </Link>
        </Button>
        <Button asChild variant="secondary">
          <Link to="/events" search={{ tab: 'active' }}>
            Всё расписание <ArrowRight aria-hidden="true" size={16} />
          </Link>
        </Button>
      </div>
    </div>
  )
}

/**
 * Первый экран главной внутренних ролей (HOM-07, HOM-08): ближайшее
 * событие с ответом — тот же кеш `events/list` и та же мутация, что в
 * расписании. Без событий — приглашение в расписание, офицеру — создание.
 */
export function NextEventHero() {
  const { role } = useAccess()
  const events = useActiveEvents()
  const next = events.data?.items[0]

  let body
  if (events.isPending) {
    body = (
      <>
        <h1 className={heroTitleClass}>Ближайшее событие</h1>
        <LoadingState label="Загрузка событий…" rows={2} />
      </>
    )
  } else if (events.isError) {
    body = (
      <>
        <h1 className={heroTitleClass}>Ближайшее событие</h1>
        <ErrorState onRetry={() => void events.refetch()} />
      </>
    )
  } else if (next) {
    body = <HeroEvent event={next} />
  } else {
    body = (
      <div className="grid max-w-2xl gap-4">
        <h1 className={heroTitleClass}>Ближайших событий нет</h1>
        <p className="m-0 text-muted-foreground">
          Когда офицеры запланируют сбор, он появится здесь — с кнопками
          «Приду», «50/50» и «Не приду».
        </p>
        <div className="flex flex-wrap gap-3">
          {hasRole(role, MANAGER_ROLES) ? (
            <Button asChild>
              <Link to="/events/new">
                <CalendarPlus aria-hidden="true" size={16} /> Создать событие
              </Link>
            </Button>
          ) : null}
          <Button asChild variant="secondary">
            <Link to="/events" search={{ tab: 'active' }}>
              Всё расписание <ArrowRight aria-hidden="true" size={16} />
            </Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <section aria-label="Ближайшее событие" className="grid gap-5 py-3">
      {body}
      <ClanPulse activeCount={events.data?.activeCount} />
    </section>
  )
}
