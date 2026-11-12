import { useCallback, useEffect, useRef, useState } from 'react'
import { MessagesSquare } from 'lucide-react'
import {
  editableUntil,
  type DiscussionMessage,
  type Reaction,
  type ThreadRef,
} from '@contracts/discussions'
import { utcToMoscow } from '@contracts/moscow-time'
import { ErrorState } from '@/components/states/error-state'
import { LoadingState } from '@/components/states/loading-state'
import { Notice } from '@/components/ui/surfaces'
import { toast } from '@/components/ui/toaster'
import { pagingOf, ReverseVirtualList } from '@/components/virtual-list'
import { useAccess } from '@/app/access'
import { errorMessage, type AppError } from '@/lib/errors'
import { formatDateMsk } from '@/lib/format-date'
import { cn } from '@/lib/utils'
import { useMarkRead, useReact, useThread, useThreadPolling } from './api'
import { Composer } from './composer'
import { MessageItem } from './message'
import { PeopleDialog, type PeopleView } from './people-dialog'
import { threadMessages, threadState } from './thread-cache'

/** Текущее время, обновляемое раз в 15 с: окно правки гаснет само. */
function useClock(intervalMs = 15_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

/** Сообщения с разделителем дня по Москве перед первым сообщением дня. */
export function withDateLabels(messages: readonly DiscussionMessage[]) {
  let previous: string | null = null
  return messages.map((message) => {
    const day = utcToMoscow(message.createdAt).date
    const dateLabel = day === previous ? null : formatDateMsk(message.createdAt)
    previous = day
    return { message, dateLabel }
  })
}

const READ_LIST_ROLES = new Set(['officer', 'admin'])

type DiscussionThreadProps = {
  thread: ThreadRef
  /** Высота ленты задаётся снаружи (колонка страницы или окно). */
  listClassName?: string
  className?: string
}

/**
 * Ветка обсуждения (DSC): лента от старых к новым с подгрузкой вверх
 * (Q-62), опрос раз в 30 с (Q-58), ответ, правка, реакции и прочтение.
 */
export function DiscussionThread({
  thread,
  listClassName,
  className,
}: DiscussionThreadProps) {
  const query = useThread(thread)
  const state = threadState(query.data)
  useThreadPolling(thread, state?.now ?? null)
  const react = useReact(thread)
  const markRead = useMarkRead(thread)
  const { role } = useAccess()
  const clock = useClock()

  const [replyTo, setReplyTo] = useState<DiscussionMessage | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [people, setPeople] = useState<PeopleView | null>(null)
  const [sent, setSent] = useState(0)
  const [atBottom, setAtBottom] = useState(true)

  const messages = threadMessages(query.data)
  const newest = messages.at(-1)

  // Низ ленты виден — отмечаем прочитанным до последнего сообщения (DSC-12).
  const markedUpTo = useRef<string | null>(null)
  const { mutate: mark } = markRead
  useEffect(() => {
    if (!atBottom || !newest || newest.mine) {
      return
    }
    if (markedUpTo.current && markedUpTo.current >= newest.createdAt) {
      return
    }
    markedUpTo.current = newest.createdAt
    mark(newest.createdAt)
  }, [atBottom, newest, mark])

  const onAtBottomChange = useCallback(
    (value: boolean) => setAtBottom(value),
    [],
  )

  if (query.isPending) {
    return <LoadingState label="Загружаем обсуждение…" rows={2} />
  }
  if (query.isError) {
    return (
      <ErrorState
        title="Обсуждение недоступно"
        {...(query.error.code === 'not_found'
          ? { message: 'Материал удалён или скрыт.' }
          : {})}
        onRetry={() => void query.refetch()}
      />
    )
  }

  const canWrite = state?.canWrite ?? false
  const readUpTo = state?.othersReadUpTo ?? null
  // Время сервера по последнему ответу ветки — для окна правки (DSC-08).
  const serverNow = state
    ? Date.parse(state.now) + (clock - query.dataUpdatedAt)
    : clock

  function toggleReaction(messageId: string, emoji: Reaction) {
    react.mutate(
      { messageId, emoji },
      {
        onError: (error) => {
          const appError = error as AppError
          toast(
            appError.code === 'state_conflict'
              ? 'Обсуждение закрыто: реакции не меняются'
              : errorMessage(appError.code),
          )
        },
      },
    )
  }

  return (
    <div className={cn('flex min-h-0 flex-col gap-3', className)}>
      {messages.length === 0 ? (
        <div
          className={cn(
            'grid place-items-center gap-2 text-center text-sm text-muted-foreground',
            listClassName,
          )}
        >
          <div className="grid justify-items-center gap-2">
            <MessagesSquare
              size={28}
              aria-hidden="true"
              className="text-primary"
            />
            Сообщений пока нет.
          </div>
        </div>
      ) : (
        <ReverseVirtualList
          items={withDateLabels(messages)}
          getKey={(item) => item.message.id}
          label="Сообщения обсуждения"
          estimateSize={88}
          paging={pagingOf(query)}
          className={listClassName}
          onAtBottomChange={onAtBottomChange}
          scrollToEndKey={sent}
          renderItem={({ message, dateLabel }) => (
            <MessageItem
              thread={thread}
              message={message}
              dateLabel={dateLabel}
              canWrite={canWrite}
              editable={
                Date.parse(editableUntil(message.createdAt)) > serverNow
              }
              read={readUpTo !== null && readUpTo >= message.createdAt}
              canSeeReaders={message.mine || READ_LIST_ROLES.has(role)}
              editing={editingId === message.id}
              onEditingChange={(editing) =>
                setEditingId(editing ? message.id : null)
              }
              onReply={() => setReplyTo(message)}
              onReact={(emoji) => toggleReaction(message.id, emoji)}
              onShowPeople={(kind) =>
                setPeople({ kind, messageId: message.id })
              }
            />
          )}
        />
      )}
      {canWrite ? (
        <Composer
          thread={thread}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          onSent={() => setSent((count) => count + 1)}
        />
      ) : (
        <Notice className="text-sm">
          Обсуждение закрыто: история доступна для чтения.
        </Notice>
      )}
      <PeopleDialog view={people} onClose={() => setPeople(null)} />
    </div>
  )
}
