import { useState } from 'react'
import { ChevronDown, Plus, X, Check } from 'lucide-react'
import {
  KH_QUEUE_IDS,
  KH_QUEUE_LABELS,
  type KhQueueEntry,
  type KhQueueId,
} from '@contracts/kh'
import type { AccessRole } from '@/app/access'
import { Button } from '@/components/ui/button'
import { VirtualList, type Paging } from '@/components/virtual-list'

export type KhQueueBoardData = Record<
  KhQueueId,
  { items: KhQueueEntry[]; hasMore: boolean }
>

type QueueCell = {
  key: string
  queueKey: KhQueueId
  entry?: KhQueueEntry
}

type KhQueueBoardProps = {
  queues: KhQueueBoardData
  accessRole: AccessRole
  userId?: string
  paging: Paging
  onJoin: (queueKey: KhQueueId) => void
  onLeave: (queueKey: KhQueueId, entryId: string) => void
  onIssue: (queueKey: KhQueueId, entryId: string) => void
  onRemove?: (queueKey: KhQueueId, entryId: string) => void
  onRepeat?: (queueKey: KhQueueId, entryId: string, autoRejoin: boolean) => void
  maxActiveQueues?: number
  activeQueueCount?: number
}

export function KhQueueBoard({
  queues,
  accessRole,
  userId,
  paging,
  onJoin,
  onLeave,
  onIssue,
  onRemove = () => undefined,
  onRepeat = () => undefined,
  maxActiveQueues = 14,
  activeQueueCount = 0,
}: KhQueueBoardProps) {
  const [expandedQueue, setExpandedQueue] = useState<KhQueueId | null>(null)
  const canJoin =
    accessRole === 'member' ||
    accessRole === 'officer' ||
    accessRole === 'admin'
  const canIssue = accessRole === 'master'
  const canRemove = accessRole === 'master'
  const canSeeFreeCell = (queueKey: KhQueueId) =>
    canJoin &&
    activeQueueCount < maxActiveQueues &&
    !queues[queueKey].hasMore &&
    !queues[queueKey].items.some((entry) => entry.userId === userId)
  const cellsInQueue = (queueKey: KhQueueId): QueueCell[] => [
    ...queues[queueKey].items.map((entry) => ({
      key: `${queueKey}:${entry.id}`,
      queueKey,
      entry,
    })),
    ...(canSeeFreeCell(queueKey)
      ? [{ key: `${queueKey}:free`, queueKey }]
      : []),
  ]

  const renderCell = (cell: QueueCell) => {
    const { queueKey, entry } = cell
    const label = KH_QUEUE_LABELS[queueKey]
    if (!entry) {
      return (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-9 w-full justify-center gap-1 border-live-border bg-live-surface px-1 text-center text-xs leading-tight text-live shadow-sm transition-[filter,background,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:scale-[1.02] hover:border-live hover:brightness-125 hover:shadow-md active:translate-y-px motion-reduce:transition-none motion-reduce:hover:transform-none"
          aria-label={`Встать в очередь «${label}»`}
          onClick={() => onJoin(queueKey)}
        >
          <Plus aria-hidden="true" className="size-4 shrink-0" />
          Свободно
        </Button>
      )
    }
    const hasControls = canIssue || canRemove || entry.userId === userId
    return (
      <div
        data-queue-entry
        className="group/kh-entry grid min-h-9 min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-0.5 rounded-lg border border-border-strong/80 bg-linear-145/srgb from-surface-inset/75 to-card/65 px-1 py-1 shadow-md backdrop-blur-[2px] transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-px hover:border-primary/70 hover:shadow-lg motion-reduce:transition-none motion-reduce:hover:transform-none"
      >
        {entry.userId === userId ? (
          <label
            data-entry-repeat
            className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-full border border-border bg-card text-xs shadow"
            title="После выдачи снова встать в очередь"
          >
            <input
              type="checkbox"
              className="size-3 accent-primary"
              aria-label="После выдачи снова встать в очередь"
              checked={entry.autoRejoin}
              onChange={(event) =>
                onRepeat(queueKey, entry.id, event.currentTarget.checked)
              }
            />
          </label>
        ) : (
          <span aria-hidden="true" className="size-6" />
        )}
        <span
          data-entry-nickname
          className="min-w-0 break-all text-center text-xs leading-tight"
        >
          {entry.gameNickname}
        </span>
        {hasControls ? (
          <span
            data-entry-controls
            className="flex min-h-6 items-center justify-end gap-0.5"
          >
            <span className="flex items-center gap-0.5">
              {canIssue ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6 shrink-0 text-live transition-[transform,background] duration-200 hover:scale-110 hover:bg-live-surface motion-reduce:transition-none motion-reduce:hover:transform-none"
                  aria-label={`Отметить выдачу: ${entry.gameNickname} в очереди «${label}»`}
                  onClick={() => onIssue(queueKey, entry.id)}
                >
                  <Check aria-hidden="true" size={15} />
                </Button>
              ) : null}
              {entry.userId === userId ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6 shrink-0 text-muted-foreground transition-[transform,background] duration-200 hover:scale-110 hover:bg-secondary motion-reduce:transition-none motion-reduce:hover:transform-none"
                  aria-label={`Убрать ${entry.gameNickname} из очереди «${label}»`}
                  onClick={() => onLeave(queueKey, entry.id)}
                >
                  <X aria-hidden="true" size={14} />
                </Button>
              ) : null}
              {canRemove ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6 shrink-0 text-destructive"
                  aria-label={`Удалить ${entry.gameNickname} из очереди «${label}»`}
                  onClick={() => onRemove(queueKey, entry.id)}
                >
                  <X aria-hidden="true" size={14} />
                </Button>
              ) : null}
            </span>
          </span>
        ) : null}
      </div>
    )
  }

  const renderColumn = (queueKey: KhQueueId) => {
    const imageNumber = KH_QUEUE_IDS.indexOf(queueKey) + 1
    const queue = queues[queueKey]
    return (
      <section
        key={queueKey}
        aria-labelledby={`kh-column-${queueKey}`}
        className="group/kh-column flex h-full min-w-0 flex-col rounded-xl border border-border-accent/70 bg-linear-145/srgb from-surface-from/80 to-surface-to/80 p-1.5 shadow-lg backdrop-blur-sm transition-[border-color,box-shadow] duration-300 hover:border-primary/80 hover:shadow-xl motion-reduce:transition-none"
      >
        <h2
          id={`kh-column-${queueKey}`}
          className="relative isolate mb-2 flex min-h-[82px] min-w-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-lg border border-border-accent/70 bg-linear-145/srgb from-surface-inset/75 to-card/75 px-1 py-2 text-center text-xs leading-tight font-bold text-highlight shadow-md backdrop-blur-sm"
        >
          <span className="pointer-events-none absolute inset-x-2 top-0 h-px bg-primary/70 shadow-sm" />
          <img
            src={`/kh-rewards/${imageNumber}.png`}
            alt=""
            className="size-12 shrink-0 object-contain drop-shadow-md"
          />
          <span className="min-w-0 break-words drop-shadow-sm">
            {KH_QUEUE_LABELS[queueKey]}
          </span>
        </h2>
        <VirtualList
          items={cellsInQueue(queueKey)}
          getKey={(cell) => cell.key}
          renderItem={renderCell}
          label={`Очередь КХ: ${KH_QUEUE_LABELS[queueKey]}`}
          estimateSize={46}
          paging={{
            ...paging,
            hasMore: queue.hasMore,
          }}
          showLoadMore={false}
          preserveWindowPositionOnResize={false}
          gap="sm"
        />
      </section>
    )
  }

  return (
    <section aria-label="Очереди КХ" className="space-y-5">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        Занято ячеек: {activeQueueCount} из {maxActiveQueues}
        {activeQueueCount >= maxActiveQueues && canJoin
          ? ' · лимит достигнут'
          : ''}
      </p>
      <div className="space-y-2 lg:hidden">
        {KH_QUEUE_IDS.map((queueKey) => {
          const imageNumber = KH_QUEUE_IDS.indexOf(queueKey) + 1
          const isExpanded = expandedQueue === queueKey
          const queue = queues[queueKey]
          return (
            <section
              key={queueKey}
              className={`overflow-hidden rounded-xl border bg-surface-from/70 shadow-md backdrop-blur-sm transition-[border-color,box-shadow] duration-300 ${isExpanded ? 'border-primary/80 shadow-lg' : 'border-border-accent/70'}`}
            >
              <div className="group/kh-mobile relative isolate min-h-14 overflow-hidden bg-linear-145/srgb from-surface-inset/80 to-card/65 transition-[background,filter] duration-200 hover:brightness-110 motion-reduce:transition-none">
                <div className="pointer-events-none relative flex min-h-14 items-center gap-3 px-3 py-2">
                  <span className="pointer-events-none absolute inset-y-2 left-0 w-1 rounded-full bg-linear-180/srgb from-highlight to-primary shadow-sm" />
                  <span className="relative grid size-10 shrink-0 place-items-center rounded-xl border border-primary/55 bg-primary/10 text-highlight shadow-md transition-[transform,box-shadow] duration-300 group-hover/kh-mobile:rotate-3 group-hover/kh-mobile:scale-105 group-hover/kh-mobile:shadow-lg motion-reduce:transition-none">
                    <img
                      src={`/kh-rewards/${imageNumber}.png`}
                      alt=""
                      className="size-10 object-contain drop-shadow-sm"
                    />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2
                      id={`kh-mobile-title-${queueKey}`}
                      className="block text-sm font-bold text-highlight drop-shadow-sm"
                    >
                      {KH_QUEUE_LABELS[queueKey]}
                    </h2>
                    <span
                      id={`kh-mobile-count-${queueKey}`}
                      className="mt-0.5 block text-xs text-muted-foreground"
                    >
                      {queue.items.length}
                      {queue.hasMore ? '+' : ''} в очереди
                    </span>
                  </div>
                  <ChevronDown
                    aria-hidden="true"
                    className={`size-5 shrink-0 text-primary transition-transform duration-300 motion-reduce:transition-none ${isExpanded ? 'rotate-180' : ''}`}
                  />
                </div>
                <button
                  type="button"
                  aria-labelledby={`kh-mobile-title-${queueKey}`}
                  aria-describedby={`kh-mobile-count-${queueKey}`}
                  aria-expanded={isExpanded}
                  aria-controls={`kh-mobile-list-${queueKey}`}
                  className="absolute inset-0 z-10 size-full rounded-xl bg-transparent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  onClick={() => setExpandedQueue(isExpanded ? null : queueKey)}
                />
              </div>
              {isExpanded ? (
                <div
                  id={`kh-mobile-list-${queueKey}`}
                  className="animate-in fade-in slide-in-from-top-1 border-t border-border-accent/60 bg-background/40 p-2 shadow-inner duration-200 motion-reduce:animate-none"
                >
                  <VirtualList
                    items={cellsInQueue(queueKey)}
                    getKey={(cell) => cell.key}
                    renderItem={renderCell}
                    label={`Очередь КХ: ${KH_QUEUE_LABELS[queueKey]}`}
                    estimateSize={46}
                    preserveWindowPositionOnResize={false}
                    paging={{ ...paging, hasMore: queue.hasMore }}
                  />
                </div>
              ) : null}
            </section>
          )
        })}
      </div>

      <div className="hidden lg:grid grid-cols-[repeat(14,minmax(0,1fr))] items-stretch gap-2">
        {KH_QUEUE_IDS.map(renderColumn)}
      </div>
    </section>
  )
}
