import { useState } from 'react'
import { Award, Check, X } from 'lucide-react'
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

export type KhQueueBoardData = Record<
  KhQueueId,
  { items: KhQueueEntry[]; hasMore: boolean }
>

type QueueCell = {
  key: string
  queueKey: KhQueueId
  position?: number
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
  const canSeeFreeCell = (queueKey: KhQueueId) =>
    canJoin &&
    !queues[queueKey].hasMore &&
    !queues[queueKey].items.some((entry) => entry.userId === userId)
  const rowCount = Math.max(
    1,
    ...KH_QUEUE_IDS.map(
      (key) => queues[key].items.length + (canSeeFreeCell(key) ? 1 : 0),
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
        return {
          key: `${queueKey}:${entry.id}`,
          queueKey,
          position: row + 1,
          entry,
        }
      }
      if (row === queue.items.length && canSeeFreeCell(queueKey)) {
        return { key: `${queueKey}:free`, queueKey }
      }
      return { key: `${queueKey}:empty:${row}`, queueKey, empty: true }
    },
  )
  const selectedQueue = queues[selected]
  const mobileCells: QueueCell[] = [
    ...selectedQueue.items.map((entry, index) => ({
      key: `${selected}:${entry.id}`,
      queueKey: selected,
      position: index + 1,
      entry,
    })),
    ...(canSeeFreeCell(selected)
      ? [{ key: `${selected}:free`, queueKey: selected }]
      : []),
  ]

  const renderCell = (cell: QueueCell, desktop = false) => {
    const separator = desktop
      ? 'h-full border-l border-b border-border-accent/60 px-1 py-1'
      : 'min-h-11 rounded-lg border border-border-accent/70 px-2 py-1'
    if (cell.empty) {
      return <div aria-hidden="true" className={separator} />
    }
    const { queueKey, entry } = cell
    const label = KH_QUEUE_LABELS[queueKey]
    if (!entry) {
      return (
        <div className={separator}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-9 w-full justify-center px-1 text-center text-xs leading-tight transition-[filter,background,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:scale-[1.02] hover:border-primary hover:brightness-125 hover:shadow-md active:translate-y-px motion-reduce:transition-none motion-reduce:hover:transform-none"
            aria-label={`Встать в очередь «${label}»`}
            onClick={() => onJoin(queueKey)}
          >
            Свободно
          </Button>
        </div>
      )
    }
    return (
      <div className={separator}>
        <div className="group/kh-entry flex min-h-9 min-w-0 items-center gap-0.5 rounded-md border border-border bg-card px-1 py-1 transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-px hover:border-border-accent hover:shadow-sm motion-reduce:transition-none motion-reduce:hover:transform-none">
          <span
            aria-label={`Место ${cell.position}`}
            className="grid size-5 shrink-0 place-items-center rounded-full bg-surface-inset text-[10px] font-semibold text-primary"
          >
            {cell.position}
          </span>
          <span className="min-w-0 flex-1 break-words text-center text-xs leading-tight">
            {entry.gameNickname}
          </span>
          {canIssue ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 shrink-0 text-live transition-[transform,background] duration-200 hover:scale-110 hover:bg-live-surface motion-reduce:transition-none motion-reduce:hover:transform-none"
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
        <div className="group/kh-mobile relative isolate mt-3 flex items-center gap-3 overflow-hidden rounded-xl border border-border-accent/80 bg-linear-145/srgb from-surface-from to-surface-to px-3 py-3 shadow-md transition-[transform,box-shadow] duration-300 hover:-translate-y-0.5 hover:shadow-lg motion-reduce:transition-none motion-reduce:hover:transform-none">
          <span className="pointer-events-none absolute inset-y-2 left-0 w-1 rounded-full bg-linear-180/srgb from-highlight to-primary" />
          <span className="relative grid size-9 shrink-0 place-items-center rounded-full border border-primary/50 bg-primary/10 text-highlight shadow-sm transition-transform duration-300 group-hover/kh-mobile:rotate-6 group-hover/kh-mobile:scale-110 motion-reduce:transition-none">
            <Award aria-hidden="true" className="size-5" />
          </span>
          <h2 className="relative min-w-0 break-words text-lg font-bold text-highlight drop-shadow-sm">
            {KH_QUEUE_LABELS[selected]}
          </h2>
        </div>
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
        <div className="grid grid-cols-[repeat(14,minmax(0,1fr))] pb-2">
          {KH_QUEUE_IDS.map((queueKey) => (
            <h2
              key={queueKey}
              className="group/kh-title relative isolate mx-1 flex min-h-[84px] min-w-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-xl border border-border-accent/80 bg-linear-145/srgb from-surface-from to-surface-to px-1.5 py-2 text-center text-xs leading-tight font-bold text-highlight shadow-md transition-[transform,box-shadow,border-color] duration-300 hover:-translate-y-1 hover:border-primary hover:shadow-xl motion-reduce:transition-none motion-reduce:hover:transform-none"
            >
              <span className="pointer-events-none absolute inset-x-2 top-0 h-px bg-primary/70 shadow-sm" />
              <span className="relative grid size-7 shrink-0 place-items-center rounded-full border border-primary/50 bg-primary/10 text-primary shadow-sm transition-[transform,box-shadow] duration-300 group-hover/kh-title:rotate-6 group-hover/kh-title:scale-110 group-hover/kh-title:shadow-md motion-reduce:transition-none">
                <Award aria-hidden="true" className="size-4" />
              </span>
              <span className="relative break-words drop-shadow-sm">
                {KH_QUEUE_LABELS[queueKey]}
              </span>
            </h2>
          ))}
        </div>
        <VirtualList
          items={desktopCells}
          getKey={(cell) => cell.key}
          renderItem={(cell) => renderCell(cell, true)}
          label="Все очереди КХ"
          estimateSize={58}
          paging={paging}
          columns={14}
          gridClassName="grid-cols-[repeat(14,minmax(0,1fr))]"
          gap="none"
        />
      </div>
    </section>
  )
}
