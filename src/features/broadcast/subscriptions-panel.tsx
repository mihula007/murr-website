import { useState } from 'react'
import { AlertTriangle, Check } from 'lucide-react'
import type {
  BroadcastSubscription,
  BroadcastSubscriptionSummary,
  MessengerLinkStatus,
} from '@contracts/broadcasts'
import { EmptyState } from '@/components/states/empty-state'
import { ErrorState } from '@/components/states/error-state'
import { LoadingState } from '@/components/states/loading-state'
import { MessengerIcon, type Messenger } from '@/components/ui/messenger-icon'
import { pagingOf, ScrollableVirtualList } from '@/components/virtual-list'
import { cn } from '@/lib/utils'
import type { useBroadcastSubscriptions } from './api'

const CHANNELS: {
  key: Messenger
  label: string
}[] = [
  { key: 'telegram', label: 'Telegram' },
  { key: 'vk', label: 'ВКонтакте' },
  { key: 'max', label: 'MAX' },
]

function MessengerState({
  messenger,
  label,
  status,
}: {
  messenger: Messenger
  label: string
  status: MessengerLinkStatus
}) {
  const disabledState =
    messenger === 'vk' ? 'сообщения недоступны' : 'бот остановлен'
  const state = !status.linked
    ? 'не привязан'
    : status.blocked
      ? disabledState
      : 'привязан'
  return (
    <fieldset
      aria-label={`${label}: ${state}`}
      title={`${label}: ${state}`}
      className="relative m-0 grid size-9 flex-none place-items-center justify-self-center border-0 p-0"
    >
      <MessengerIcon
        messenger={messenger}
        className={cn('size-7', !status.linked && 'opacity-40')}
      />
      {status.linked && !status.blocked ? (
        <span
          aria-hidden="true"
          className="absolute -top-0.5 -right-0.5 grid size-4 place-items-center rounded-full border-2 border-card bg-live text-primary-foreground"
        >
          <Check size={10} strokeWidth={3} />
        </span>
      ) : null}
      {status.linked && status.blocked ? (
        <span
          aria-hidden="true"
          className="absolute -top-0.5 -right-0.5 grid size-4 place-items-center rounded-full border-2 border-card bg-destructive text-primary-foreground"
        >
          <AlertTriangle size={9} strokeWidth={3} />
        </span>
      ) : null}
    </fieldset>
  )
}

function SubscriptionRow({ member }: { member: BroadcastSubscription }) {
  const statuses: Record<Messenger, MessengerLinkStatus> = {
    telegram: member.telegram,
    vk: member.vk,
    max: member.max,
  }
  const hasNoLinks = CHANNELS.every(({ key }) => !statuses[key].linked)
  return (
    <div
      className={cn(
        'flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-inset px-3 py-2.5',
        hasNoLinks && 'border-highlight-line bg-item-highlight!',
      )}
    >
      <strong className="min-w-0 flex-1 break-words">
        {member.gameNickname}
      </strong>
      <div className="grid w-48 flex-none grid-cols-3">
        {CHANNELS.map(({ key, label }) => (
          <MessengerState
            key={key}
            messenger={key}
            label={label}
            status={statuses[key]}
          />
        ))}
      </div>
    </div>
  )
}

/** Read-only messenger link overview for officers and administrators (BRC-15). */
export function SubscriptionAnalytics({
  summary,
}: {
  summary: BroadcastSubscriptionSummary | null
}) {
  if (!summary) {
    return null
  }

  const metrics = [
    { label: 'Есть хотя бы одна', value: `${summary.any} из ${summary.total}` },
    { label: 'Без подписки', value: String(summary.none) },
    { label: 'Telegram', value: String(summary.telegram) },
    { label: 'ВКонтакте', value: String(summary.vk) },
    { label: 'MAX', value: String(summary.max) },
  ]

  return (
    <section
      aria-label="Аналитика подписок"
      className="grid w-full min-w-0 grid-cols-2 gap-1 min-[560px]:grid-cols-3 min-[1000px]:grid-cols-5"
    >
      {metrics.map(({ label, value }) => (
        <fieldset
          key={label}
          aria-label={label}
          className="m-0 grid min-w-0 gap-0.5 rounded-lg border border-border bg-card px-2 py-1"
        >
          <span className="truncate text-[11px] leading-tight text-muted-foreground">
            {label}
          </span>
          <strong className="text-base leading-tight tabular-nums">
            {value}
          </strong>
        </fieldset>
      ))}
    </section>
  )
}

export function SubscriptionsPanel({
  unlinkedOnly,
  onUnlinkedOnlyChange,
  subscriptions,
}: {
  unlinkedOnly: boolean
  onUnlinkedOnlyChange: (unlinkedOnly: boolean) => void
  subscriptions: ReturnType<typeof useBroadcastSubscriptions>
}) {
  const [lastGoodItems, setLastGoodItems] = useState<BroadcastSubscription[]>(
    [],
  )
  const members = subscriptions.data?.items ?? lastGoodItems

  const handleUnlinkedOnlyChange = (value: boolean) => {
    setLastGoodItems(subscriptions.data?.items ?? lastGoodItems)
    onUnlinkedOnlyChange(value)
  }

  let content
  if (subscriptions.isPending && members.length === 0) {
    content = <LoadingState label="Загружаем подписки…" rows={3} />
  } else if (subscriptions.isError && members.length === 0) {
    content = <ErrorState onRetry={() => void subscriptions.refetch()} />
  } else if (members.length === 0) {
    content = unlinkedOnly ? (
      <EmptyState
        title="Людей без привязки не нашли"
        description="Снимите флажок, чтобы увидеть весь состав."
      />
    ) : (
      <EmptyState
        title="Состав пока пуст"
        description="Участники появятся здесь, когда получат внутренний доступ."
      />
    )
  } else {
    content = (
      <>
        <div className="hidden grid-cols-[minmax(0,1fr)_192px] items-center gap-3 px-3 text-xs font-semibold text-muted-foreground min-[560px]:grid">
          <span>Участник</span>
          <fieldset
            aria-label="Подписи каналов"
            className="m-0 grid w-48 grid-cols-3 border-0 p-0 text-center"
          >
            {CHANNELS.map(({ key, label }) => (
              <span key={key} className="min-w-0 break-words leading-tight">
                {label}
              </span>
            ))}
          </fieldset>
        </div>
        <ScrollableVirtualList
          label="Участники и привязки мессенджеров"
          items={members}
          getKey={(member) => member.id}
          estimateSize={62}
          viewportRows={15}
          paging={pagingOf(subscriptions)}
          renderItem={(member) => <SubscriptionRow member={member} />}
        />
      </>
    )
  }

  return (
    <section aria-label="Подписки на рассылки" className="grid gap-4">
      <p className="m-0 text-sm text-muted-foreground">
        Привязанные каналы отмечены галочкой. Предупреждение означает, что
        отправка в этот мессенджер остановлена. Строка с подсветкой — без
        привязок.
      </p>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          className="size-4 flex-none accent-primary"
          checked={unlinkedOnly}
          onChange={(event) => handleUnlinkedOnlyChange(event.target.checked)}
        />
        Показать без подписки
      </label>
      <div>
        {subscriptions.isError && members.length > 0 ? (
          <ErrorState
            className="mb-3 p-4"
            onRetry={() => void subscriptions.refetch()}
          />
        ) : null}
      </div>
      <div>{content}</div>
    </section>
  )
}
