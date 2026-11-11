import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { CalendarClock, Check, ChevronRight } from 'lucide-react'
import {
  EVENT_ANSWER_LABELS,
  EVENT_ANSWERS,
  EVENT_TYPE_LABELS,
  type EventAnswer,
  type EventSummary,
} from '@contracts/events'
import { ConfirmActionDialog } from '@/components/confirm-action-dialog'
import { Button, buttonVariants } from '@/components/ui/button'
import { Badge, Card, Notice } from '@/components/ui/surfaces'
import { toast } from '@/components/ui/toaster'
import { errorMessage, type AppError } from '@/lib/errors'
import { formatDate, formatDateTimeMsk } from '@/lib/format-date'
import { cn } from '@/lib/utils'
import { useDeleteEvent, useRespondToEvent } from './api'
import { eventKeys } from './query-keys'

/** Автор события: ник, «Автоматически» у постоянных (Q-47) или удалённый. */
export function eventAuthor(event: EventSummary) {
  if (event.createdBy) {
    return event.createdBy.gameNickname
  }
  return event.recurring ? 'Автоматически' : 'Пользователь удалён'
}

/** Три счётчика ответов (EVT-01); вместимости нет (Q-07). */
function Counts({ event }: { event: EventSummary }) {
  return (
    <ul
      aria-label="Ответы участников"
      className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-sm text-muted-foreground"
    >
      {EVENT_ANSWERS.map((answer) => (
        <li key={answer}>
          {EVENT_ANSWER_LABELS[answer]}:{' '}
          <strong className="text-foreground tabular-nums">
            {event.counts[answer]}
          </strong>
        </li>
      ))}
    </ul>
  )
}

/** Сообщение о конфликте ответа: событие началось, закрыто или удалено. */
function conflictMessage(error: AppError) {
  if (error.code === 'not_found') {
    return 'Событие удалено'
  }
  return error.fields.reason === 'started'
    ? 'Событие уже началось: ответы закрыты'
    : 'Событие закрыто'
}

/**
 * Ответ участника (EVT-04, EVT-05). После выбора — сохранённое решение и
 * «Изменить решение»; прежний ответ действует до нового выбора.
 */
function Attendance({ event }: { event: EventSummary }) {
  const queryClient = useQueryClient()
  const respond = useRespondToEvent()
  const [changing, setChanging] = useState(false)
  const mine = event.myAnswer

  async function choose(answer: EventAnswer) {
    try {
      await respond.mutateAsync({ eventId: event.id, answer })
      setChanging(false)
      toast(mine ? 'Решение изменено' : 'Ответ сохранён')
    } catch (error) {
      const appError = error as AppError
      if (appError.code === 'state_conflict' || appError.code === 'not_found') {
        toast(conflictMessage(appError))
        await queryClient.invalidateQueries({ queryKey: eventKeys.all })
        return
      }
      toast(errorMessage(appError.code))
    }
  }

  if (!event.canAnswer) {
    return (
      <Notice>
        {event.closedAt ? 'Событие закрыто' : 'Событие началось'}: ответы больше
        не принимаются.
        {mine ? (
          <>
            {' '}
            Ваше решение:{' '}
            <strong className="text-primary">
              {EVENT_ANSWER_LABELS[mine]}
            </strong>
          </>
        ) : null}
      </Notice>
    )
  }

  if (mine && !changing) {
    return (
      <div className="grid gap-2">
        <Notice>
          Ваше решение:{' '}
          <strong className="text-primary">{EVENT_ANSWER_LABELS[mine]}</strong>
        </Notice>
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          onClick={() => setChanging(true)}
        >
          Изменить решение
        </Button>
      </div>
    )
  }

  return (
    <fieldset className="m-0 grid gap-2 border-0 p-0">
      <legend className="mb-2 text-sm font-semibold">
        {mine ? 'Выберите новое решение' : 'Ваше решение'}
      </legend>
      <div className="grid grid-cols-3 gap-2 max-xs:grid-cols-1">
        {EVENT_ANSWERS.map((answer) => (
          <Button
            key={answer}
            type="button"
            variant={answer === 'yes' ? 'default' : 'secondary'}
            disabled={respond.isPending}
            aria-pressed={answer === mine}
            className="min-w-0"
            onClick={() => void choose(answer)}
          >
            {answer === mine ? <Check size={16} aria-hidden="true" /> : null}
            {EVENT_ANSWER_LABELS[answer]}
          </Button>
        ))}
      </div>
      {mine ? (
        <Button
          type="button"
          variant="ghost"
          disabled={respond.isPending}
          onClick={() => setChanging(false)}
        >
          Оставить «{EVENT_ANSWER_LABELS[mine]}»
        </Button>
      ) : null}
    </fieldset>
  )
}

/** Правка и удаление: автор-офицер, любой офицер у постоянных, админ. */
function Management({
  event,
  onDeleted,
}: {
  event: EventSummary
  onDeleted?: (() => void) | undefined
}) {
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)
  const remove = useDeleteEvent()

  return (
    <>
      <div className="grid grid-cols-2 gap-2 border-t border-border pt-3 max-xs:grid-cols-1">
        <Link
          to="/events/$id/edit"
          params={{ id: event.id }}
          className={cn(
            buttonVariants({ variant: 'secondary', size: 'sm' }),
            'no-underline',
          )}
        >
          Редактировать
        </Link>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="text-destructive"
          onClick={() => setConfirming(true)}
        >
          Удалить
        </Button>
      </div>
      <ConfirmActionDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Удалить «${event.title}»?`}
        description="Событие и все ответы участников будут удалены без возможности восстановления."
        confirmLabel="Удалить"
        pendingLabel="Удаляем…"
        onConfirm={async () => {
          await remove.mutateAsync(event.id)
          toast('Событие удалено')
          if (onDeleted) {
            onDeleted()
          } else {
            await navigate({ to: '/events', search: { tab: 'active' } })
          }
        }}
      />
    </>
  )
}

type EventCardProps = {
  event: EventSummary
  /** В списке название ведёт на страницу события (EVT-06). */
  linkToPage?: boolean
  onDeleted?: () => void
  className?: string
}

/** Карточка события по образцу `.card` расписания прототипа (EVT-01). */
export function EventCard({
  event,
  linkToPage = false,
  onDeleted,
  className,
}: EventCardProps) {
  return (
    <Card className={cn('grid min-w-0 content-start gap-3', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{EVENT_TYPE_LABELS[event.type]}</Badge>
        {event.recurring ? (
          <Badge className="border-border text-muted-foreground">
            Постоянное
          </Badge>
        ) : null}
        {event.closedAt ? (
          <Badge className="border-border text-muted-foreground">
            Закрыто {formatDate(event.closedAt)}
          </Badge>
        ) : null}
      </div>
      <h2 className="m-0 text-lg leading-snug font-bold break-words">
        {linkToPage ? (
          <Link
            to="/events/$id"
            params={{ id: event.id }}
            className="inline-flex max-w-full items-start gap-1 text-foreground no-underline hover:text-primary"
          >
            <span className="min-w-0 break-words">{event.title}</span>
            <ChevronRight
              size={18}
              aria-hidden="true"
              className="mt-0.5 flex-none text-muted-foreground"
            />
          </Link>
        ) : (
          event.title
        )}
      </h2>
      <p
        className={cn(
          'm-0 break-words whitespace-pre-line text-muted-foreground',
          linkToPage && 'line-clamp-3',
        )}
      >
        {event.description}
      </p>
      <p className="m-0 flex items-center gap-1.5 text-sm text-foreground">
        <CalendarClock
          size={16}
          aria-hidden="true"
          className="flex-none text-primary"
        />
        <time dateTime={event.startsAt}>
          {formatDateTimeMsk(event.startsAt)}
        </time>
      </p>
      <Counts event={event} />
      <p className="m-0 text-xs text-muted-foreground">
        Автор: {eventAuthor(event)}
      </p>
      <Attendance event={event} />
      {event.canManage ? (
        <Management event={event} onDeleted={onDeleted} />
      ) : null}
    </Card>
  )
}
