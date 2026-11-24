import { useState } from 'react'
import { Check, X } from 'lucide-react'
import {
  KH_QUEUE_IDS,
  KH_QUEUE_LABELS,
  type KhQueueEntry,
  type KhQueueId,
} from '@contracts/kh'
import type { AccessRole } from '@/app/access'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { VirtualList, type Paging } from '@/components/virtual-list'
import { cn } from '@/lib/utils'

export type KhQueueBoardData = Record<
  KhQueueId,
  { items: KhQueueEntry[]; hasMore: boolean }
>

type QueueCell = {
  key: string
  queueKey: KhQueueId
  entry?: KhQueueEntry
  empty?: boolean
}

type KhQueueBoardProps = {
  queues: KhQueueBoardData
  accessRole: AccessRole
  userId?: string
  paging: Paging
  onJoin: (queueKey: KhQueueId) => void
  onLeave: (queueKey: KhQueueId, entryId: string) => void
  onIssue: (queueKey: KhQueueId, entryId: string) => void
}

export function KhQueueBoard({
  queues,
  accessRole,
  userId,
  paging,
  onJoin,
  onLeave,
  onIssue,
}: KhQueueBoardProps) {
  const [selected, setSelected] = useState<KhQueueId>('summons')
  const canJoin =
    accessRole === 'member' ||
    accessRole === 'officer' ||
    accessRole === 'admin'
  const canIssue = accessRole === 'master'
  const rowCount = Math.max(
    1,
    ...KH_QUEUE_IDS.map(
      (key) => queues[key].items.length + (queues[key].hasMore ? 0 : 1),
    ),
  )
  const desktopCells: QueueCell[] = Array.from(
    { length: rowCount * KH_QUEUE_IDS.length },
    (_, index) => {
      const row = Math.floor(index / KH_QUEUE_IDS.length)
      const queueKey = KH_QUEUE_IDS[index % KH_QUEUE_IDS.length]!
      const queue = queues[queueKey]
      const entry = queue.items[row]
      if (entry) {
        return { key: `${queueKey}:${entry.id}`, queueKey, entry }
      }
      if (row === queue.items.length && !queue.hasMore) {
        return { key: `${queueKey}:free`, queueKey }
      }
      return { key: `${queueKey}:empty:${row}`, queueKey, empty: true }
    },
  )
  const selectedQueue = queues[selected]
  const mobileCells: QueueCell[] = [
    ...selectedQueue.items.map((entry) => ({
      key: `${selected}:${entry.id}`,
      queueKey: selected,
      entry,
    })),
    ...(!selectedQueue.hasMore
      ? [{ key: `${selected}:free`, queueKey: selected }]
      : []),
  ]

  const renderCell = (cell: QueueCell) => {
    if (cell.empty) {
      return <span aria-hidden="true" className="block min-h-11" />
    }
    const { queueKey, entry } = cell
    const label = KH_QUEUE_LABELS[queueKey]
    if (!entry) {
      return canJoin ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11 w-full justify-center px-1 text-center text-xs leading-tight"
          aria-label={`Встать в очередь «${label}»`}
          onClick={() => onJoin(queueKey)}
        >
          Свободно
        </Button>
      ) : (
        <span className="flex min-h-11 items-center justify-center text-xs text-muted-foreground">
          Свободно
        </span>
      )
    }
    return (
      <div className="flex min-h-11 min-w-0 items-center gap-0.5 rounded-md border border-border bg-card px-1 py-1">
        <span className="min-w-0 flex-1 break-words text-center text-xs leading-tight">
          {entry.gameNickname}
        </span>
        {canIssue ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-live"
            aria-label={`Отметить выдачу: ${entry.gameNickname} в очереди «${label}»`}
            onClick={() => onIssue(queueKey, entry.id)}
          >
            <Check aria-hidden="true" size={16} />
          </Button>
        ) : null}
        {entry.userId === userId ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-muted-foreground"
            aria-label={`Убрать ${entry.gameNickname} из очереди «${label}»`}
            onClick={() => onLeave(queueKey, entry.id)}
          >
            <X aria-hidden="true" size={15} />
          </Button>
        ) : null}
      </div>
    )
  }

  return (
    <section aria-label="Очереди КХ" className="space-y-5">
      <div className="lg:hidden">
        <Select
          aria-label="Выбрать очередь КХ"
          value={selected}
          onValueChange={(value) => setSelected(value as KhQueueId)}
          options={KH_QUEUE_IDS.map((queueKey) => ({
            value: queueKey,
            label: KH_QUEUE_LABELS[queueKey],
          }))}
        />
        <div className="mt-4">
          <VirtualList
            items={mobileCells}
            getKey={(cell) => cell.key}
            renderItem={(cell) => renderCell(cell)}
            label="Очередь КХ на телефоне"
            estimateSize={54}
            paging={{ ...paging, hasMore: selectedQueue.hasMore }}
          />
        </div>
      </div>

      <div className="hidden lg:block">
        <div className="grid grid-cols-[repeat(14,minmax(0,1fr))] gap-2 pb-3">
          {KH_QUEUE_IDS.map((queueKey) => (
            <h2
              key={queueKey}
              className={cn(
                'min-w-0 break-words text-center text-sm leading-tight',
                'font-bold text-foreground',
              )}
            >
              {KH_QUEUE_LABELS[queueKey]}
            </h2>
          ))}
        </div>
        <VirtualList
          items={desktopCells}
          getKey={(cell) => cell.key}
          renderItem={(cell) => renderCell(cell)}
          label="Все очереди КХ"
          estimateSize={58}
          paging={paging}
          columns={14}
          gridClassName="grid-cols-[repeat(14,minmax(0,1fr))]"
          gap="sm"
        />
      </div>
    </section>
  )
}
