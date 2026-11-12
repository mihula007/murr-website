import type { DiscussionPerson, Reaction } from '@contracts/discussions'
import { ErrorState } from '@/components/states/error-state'
import { LoadingState } from '@/components/states/loading-state'
import { Avatar } from '@/components/ui/avatar'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useReactionPeople, useReaders } from './api'

export type PeopleView = { kind: 'readers' | 'reactions'; messageId: string }

const DELETED = 'Пользователь удалён'

function PeopleList({
  items,
  truncated,
  empty,
}: {
  items: (DiscussionPerson & { emoji?: Reaction })[]
  truncated: boolean
  empty: string
}) {
  if (items.length === 0) {
    return <p className="m-0 text-sm text-muted-foreground">{empty}</p>
  }
  return (
    <>
      <ul className="m-0 grid list-none gap-2 p-0">
        {items.map((person, index) => (
          <li key={index} className="flex min-w-0 items-center gap-3">
            <Avatar
              name={person.gameNickname ?? DELETED}
              src={person.avatarUrl}
            />
            <span className="min-w-0 flex-1 truncate">
              {person.gameNickname ?? (
                <span className="text-muted-foreground">{DELETED}</span>
              )}
            </span>
            {person.emoji ? (
              <span aria-label={`реакция ${person.emoji}`} className="text-lg">
                {person.emoji}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {truncated ? (
        <p className="m-0 text-xs text-muted-foreground">
          Показана только часть списка.
        </p>
      ) : null}
    </>
  )
}

function Readers({ messageId }: { messageId: string }) {
  const query = useReaders(messageId, true)
  if (query.isPending) {
    return <LoadingState label="Загружаем…" />
  }
  if (query.isError) {
    return <ErrorState onRetry={() => void query.refetch()} />
  }
  return (
    <PeopleList
      items={query.data.items}
      truncated={query.data.truncated}
      empty="Сообщение ещё никто не прочитал."
    />
  )
}

function Reactions({ messageId }: { messageId: string }) {
  const query = useReactionPeople(messageId, true)
  if (query.isPending) {
    return <LoadingState label="Загружаем…" />
  }
  if (query.isError) {
    return <ErrorState onRetry={() => void query.refetch()} />
  }
  return (
    <PeopleList
      items={query.data.items}
      truncated={query.data.truncated}
      empty="Реакций пока нет."
    />
  )
}

/** Кто прочитал (Q-59) или кто поставил реакции (DSC-11). */
export function PeopleDialog({
  view,
  onClose,
}: {
  view: PeopleView | null
  onClose: () => void
}) {
  return (
    <Dialog
      open={view !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose()
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {view?.kind === 'reactions' ? 'Реакции' : 'Кто прочитал'}
          </DialogTitle>
          <DialogDescription>
            {view?.kind === 'reactions'
              ? 'Участники, отметившие сообщение.'
              : 'Участники, открывшие обсуждение после этого сообщения.'}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60svh] overflow-y-auto">
          {view?.kind === 'readers' ? (
            <Readers messageId={view.messageId} />
          ) : view ? (
            <Reactions messageId={view.messageId} />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
