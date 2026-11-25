import { useState } from 'react'
import {
  CircleDot,
  Coins,
  CreditCard,
  Crown,
  Disc3,
  DoorOpen,
  Gem,
  Hand,
  Megaphone,
  PawPrint,
  Plus,
  Scale,
  Sparkles,
  Trophy,
  UserRound,
  X,
  Check,
  type LucideIcon,
} from 'lucide-react'
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

const KH_QUEUE_ICONS: Record<KhQueueId, LucideIcon> = {
  summons: Megaphone,
  kh_hands: Hand,
  scale_buyout: Scale,
  highest_buyout: Crown,
  highest: Trophy,
  meteorites: Sparkles,
  uf_passes: DoorOpen,
  essence: CircleDot,
  scale: Gem,
  dobi_stones: Coins,
  s_cards: CreditCard,
  kh_passes: DoorOpen,
  disc: Disc3,
  pet: PawPrint,
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
  const cellsInQueue = (queueKey: KhQueueId): QueueCell[] => [
    ...queues[queueKey].items.map((entry, index) => ({
      key: `${queueKey}:${entry.id}`,
      queueKey,
      position: index + 1,
      entry,
    })),
    ...(canSeeFreeCell(queueKey)
      ? [{ key: `${queueKey}:free`, queueKey }]
      : []),
  ]
  const selectedQueue = queues[selected]
  const SelectedIcon = KH_QUEUE_ICONS[selected]

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
    return (
      <div className="group/kh-entry flex min-h-9 min-w-0 items-center gap-0.5 rounded-lg border border-border-strong/80 bg-linear-145/srgb from-surface-inset to-card px-1 py-1 shadow-sm transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-px hover:border-primary/70 hover:shadow-md motion-reduce:transition-none motion-reduce:hover:transform-none">
        <span
          aria-label={`Место ${cell.position}`}
          className="grid size-5 shrink-0 place-items-center rounded-full border border-primary/40 bg-primary/10 text-[10px] font-bold text-highlight shadow-sm"
        >
          {cell.position}
        </span>
        <UserRound
          aria-hidden="true"
          className="size-3 shrink-0 text-primary"
        />
        <span className="min-w-0 flex-1 break-all text-center text-xs leading-tight">
          {entry.gameNickname}
        </span>
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
      </div>
    )
  }

  const renderColumn = (queueKey: KhQueueId) => {
    const Icon = KH_QUEUE_ICONS[queueKey]
    const queue = queues[queueKey]
    return (
      <section
        key={queueKey}
        aria-labelledby={`kh-column-${queueKey}`}
        className="group/kh-column flex h-full min-w-0 flex-col rounded-xl border border-border-accent/70 bg-linear-145/srgb from-surface-from to-surface-to p-1.5 shadow-md transition-[border-color,box-shadow] duration-300 hover:border-primary/80 hover:shadow-lg"
      >
        <h2
          id={`kh-column-${queueKey}`}
          className="relative isolate mb-2 flex min-h-[82px] min-w-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-lg border border-border-accent/60 bg-linear-145/srgb from-surface-inset to-card px-1 py-2 text-center text-xs leading-tight font-bold text-highlight shadow-sm"
        >
          <span className="pointer-events-none absolute inset-x-2 top-0 h-px bg-primary/70 shadow-sm" />
          <span className="grid size-8 shrink-0 place-items-center rounded-full border border-primary/50 bg-primary/10 text-primary shadow-sm transition-[transform,box-shadow] duration-300 group-hover/kh-column:rotate-6 group-hover/kh-column:scale-110 group-hover/kh-column:shadow-md motion-reduce:transition-none">
            <Icon aria-hidden="true" className="size-4" />
          </span>
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
          gap="sm"
        />
      </section>
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
            <SelectedIcon aria-hidden="true" className="size-5" />
          </span>
          <h2 className="relative min-w-0 break-words text-lg font-bold text-highlight drop-shadow-sm">
            {KH_QUEUE_LABELS[selected]}
          </h2>
        </div>
        <div className="mt-4">
          <VirtualList
            items={cellsInQueue(selected)}
            getKey={(cell) => cell.key}
            renderItem={renderCell}
            label="Очередь КХ на телефоне"
            estimateSize={54}
            paging={{ ...paging, hasMore: selectedQueue.hasMore }}
          />
        </div>
      </div>

      <div className="hidden lg:grid grid-cols-[repeat(14,minmax(0,1fr))] items-stretch gap-2">
        {KH_QUEUE_IDS.map(renderColumn)}
      </div>
    </section>
  )
}
