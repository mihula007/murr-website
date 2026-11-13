import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import {
  CalendarClock,
  Check,
  ChevronRight,
  Lock,
  MoreHorizontal,
} from 'lucide-react'
import {
  EVENT_ANSWER_LABELS,
  EVENT_ANSWERS,
  EVENT_TYPE_LABELS,
  type EventAnswer,
  type EventSummary,
} from '@contracts/events'
import { hasRole, MANAGER_ROLES, useAccess } from '@/app/access'
import { ConfirmActionDialog } from '@/components/confirm-action-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Badge, Card } from '@/components/ui/surfaces'
import { toast } from '@/components/ui/toaster'
import { errorMessage, type AppError } from '@/lib/errors'
import { formatDateMsk, formatDateTimeMsk } from '@/lib/format-date'
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

/** Метки типа, постоянного выпуска и закрытия события. */
export function EventBadges({ event }: { event: EventSummary }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge>{EVENT_TYPE_LABELS[event.type]}</Badge>
      {event.recurring ? (
        <Badge className="border-border text-muted-foreground">
          Постоянное
        </Badge>
      ) : null}
      {event.closedAt ? (
        <Badge className="border-border text-muted-foreground">
          Закрыто {formatDateMsk(event.closedAt)}
        </Badge>
      ) : null}
    </div>
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

const tallyCellClass =
  'grid min-w-0 justify-items-center gap-0.5 rounded-xl border border-border bg-surface-inset px-2 py-2.5 text-center'
const tallyMineClass = 'border-primary bg-item-highlight'

/**
 * Числа ответов (EVT-01) одной строкой из трёх ячеек: крупное число и
 * подпись. Для экранных чтецов те же числа — скрытым списком, у кнопок
 * выбора имя — только сам ответ.
 */
function TallyCell({
  answer,
  event,
}: {
  answer: EventAnswer
  event: EventSummary
}) {
  const mine = event.myAnswer === answer
  return (
    <>
      <span
        className={cn(
          'text-2xl leading-none font-bold tabular-nums',
          mine && 'text-highlight',
        )}
      >
        {event.counts[answer]}
      </span>
      <span className="flex items-center gap-1 text-sm text-muted-foreground">
        {mine ? (
          <Check size={14} aria-hidden="true" className="text-primary" />
        ) : null}
        {EVENT_ANSWER_LABELS[answer]}
      </span>
    </>
  )
}

/**
 * Ответ участника (EVT-04, EVT-05) и числа ответов. До выбора — три кнопки
 * с числами; после — те же ячейки без нажатия, сохранённое решение и
 * «Изменить решение»; прежний ответ действует до нового выбора.
 */
export function EventAnswers({ event }: { event: EventSummary }) {
  const queryClient = useQueryClient()
  const respond = useRespondToEvent()
  const [changing, setChanging] = useState(false)
  const mine = event.myAnswer
  const choosing = event.canAnswer && (!mine || changing)

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

  const counts = (
    <ul aria-label="Ответы участников" className="sr-only">
      {EVENT_ANSWERS.map((answer) => (
        <li key={answer}>
          {EVENT_ANSWER_LABELS[answer]}: {event.counts[answer]}
        </li>
      ))}
    </ul>
  )

  if (choosing) {
    return (
      <fieldset className="m-0 grid gap-2 border-0 p-0">
        <legend className="mb-2 text-sm font-semibold">
          {mine ? 'Выберите новое решение' : 'Ваше решение'}
        </legend>
        {counts}
        <div className="grid grid-cols-3 gap-2">
          {EVENT_ANSWERS.map((answer) => (
            <button
              key={answer}
              type="button"
              aria-label={EVENT_ANSWER_LABELS[answer]}
              aria-pressed={answer === mine}
              disabled={respond.isPending}
              className={cn(
                tallyCellClass,
                'cursor-pointer text-foreground transition-colors not-disabled:hover:border-input-hover disabled:cursor-not-allowed disabled:opacity-60',
                answer === mine && tallyMineClass,
              )}
              onClick={() => void choose(answer)}
            >
              <TallyCell answer={answer} event={event} />
            </button>
          ))}
        </div>
        {mine ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={respond.isPending}
            onClick={() => setChanging(false)}
          >
            Оставить «{EVENT_ANSWER_LABELS[mine]}»
          </Button>
        ) : null}
      </fieldset>
    )
  }

  return (
    <div className="grid gap-3">
      {counts}
      <div aria-hidden="true" className="grid grid-cols-3 gap-2">
        {EVENT_ANSWERS.map((answer) => (
          <div
            key={answer}
            className={cn(tallyCellClass, answer === mine && tallyMineClass)}
          >
            <TallyCell answer={answer} event={event} />
          </div>
        ))}
      </div>
      {event.canAnswer ? (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <p className="m-0 text-sm">
            Ваше решение:{' '}
            <strong className="text-primary">
              {mine ? EVENT_ANSWER_LABELS[mine] : ''}
            </strong>
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setChanging(true)}
          >
            Изменить решение
          </Button>
        </div>
      ) : (
        <p className="m-0 flex items-start gap-2 text-sm text-muted-foreground">
          <Lock size={14} aria-hidden="true" className="mt-1 flex-none" />
          <span>
            {event.closedAt ? 'Событие закрыто' : 'Событие началось'}: ответы
            больше не принимаются.
            {mine ? (
              <>
                {' '}
                Ваше решение:{' '}
                <strong className="text-primary">
                  {EVENT_ANSWER_LABELS[mine]}
                </strong>
              </>
            ) : null}
          </span>
        </p>
      )}
    </div>
  )
}

type Pending = 'delete' | null

/**
 * Управление событием в меню «⋯» (как у голосований): правка и удаление —
 * автор-офицер, любой офицер у постоянных, админ (Q-47); рассылка —
 * офицер и админ у незакрытого события (EVT-15). Без доступных действий
 * меню не показывается.
 */
export function EventActions({
  event,
  onDeleted,
  className,
}: {
  event: EventSummary
  onDeleted?: (() => void) | undefined
  className?: string
}) {
  const navigate = useNavigate()
  const { role } = useAccess()
  const [pending, setPending] = useState<Pending>(null)
  const remove = useDeleteEvent()
  const canPrepare = event.closedAt === null && hasRole(role, MANAGER_ROLES)

  if (!event.canManage && !canPrepare) {
    return null
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className={cn('flex-none', className)}
            aria-label={`Управление событием «${event.title}»`}
          >
            <MoreHorizontal aria-hidden="true" size={18} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {event.canManage ? (
            <DropdownMenuItem asChild>
              <Link to="/events/$id/edit" params={{ id: event.id }}>
                Изменить
              </Link>
            </DropdownMenuItem>
          ) : null}
          {canPrepare ? (
            <DropdownMenuItem asChild>
              <Link to="/broadcast" search={{ source: 'event', id: event.id }}>
                Подготовить рассылку
              </Link>
            </DropdownMenuItem>
          ) : null}
          {event.canManage ? (
            <DropdownMenuItem
              className="text-destructive data-highlighted:text-destructive"
              onSelect={() => setPending('delete')}
            >
              Удалить
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmActionDialog
        open={pending === 'delete'}
        onOpenChange={(open) => setPending(open ? 'delete' : null)}
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
  className?: string
}

/** Карточка события в расписании и на главной (EVT-01). */
export function EventCard({ event, className }: EventCardProps) {
  return (
    <Card className={cn('grid min-w-0 content-start gap-3', className)}>
      <div className="flex items-start justify-between gap-2">
        <EventBadges event={event} />
        <EventActions event={event} />
      </div>
      <h2 className="m-0 text-lg leading-snug font-bold break-words">
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
      </h2>
      <p className="m-0 line-clamp-3 break-words whitespace-pre-line text-muted-foreground">
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
      <p className="m-0 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
        <span>Автор: {eventAuthor(event)}</span>
        {event.messageCount ? (
          <span>Сообщений в обсуждении: {event.messageCount}</span>
        ) : null}
      </p>
      <EventAnswers event={event} />
    </Card>
  )
}
