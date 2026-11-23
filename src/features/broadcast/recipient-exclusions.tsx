import { useState } from 'react'
import type {
  BroadcastRecipientOption,
  BroadcastRecipientsResponse,
  SendableChannel,
} from '@contracts/broadcasts'
import { BROADCAST_CHANNEL_LABELS } from '@contracts/broadcasts'
import { FormField } from '@/components/form/form-field'
import { EmptyState } from '@/components/states/empty-state'
import { ErrorState } from '@/components/states/error-state'
import { LoadingState } from '@/components/states/loading-state'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { toast } from '@/components/ui/toaster'
import { pagingOf, ScrollableVirtualList } from '@/components/virtual-list'
import { cn } from '@/lib/utils'
import { useClasses } from '@/features/catalog/use-classes'
import { useBroadcastRecipientOptions } from './api'

export type ExcludedRecipient = {
  id: string
  channels: SendableChannel[]
}

const RECIPIENT_ROW_HEIGHT = 48
const RECIPIENT_END_PADDING = RECIPIENT_ROW_HEIGHT * 2 + 16

function RecipientRow({
  member,
  selectedChannels,
  excluded,
  disabled,
  onToggle,
}: {
  member: BroadcastRecipientOption
  selectedChannels: SendableChannel[]
  excluded: boolean
  disabled: boolean
  onToggle: (member: BroadcastRecipientOption) => void
}) {
  const channelNames = member.channels
    .filter((channel) => selectedChannels.includes(channel))
    .map((channel) => BROADCAST_CHANNEL_LABELS[channel])
    .join(' · ')

  return (
    <label
      className={cn(
        'flex h-12 min-w-0 cursor-pointer items-center gap-3 overflow-hidden rounded-lg border border-border bg-surface-inset px-3 py-2.5',
        excluded && 'border-highlight-line bg-item-highlight!',
      )}
    >
      <input
        type="checkbox"
        className="size-4 flex-none accent-primary"
        aria-label={`Получит: ${member.gameNickname}`}
        checked={!excluded}
        disabled={disabled}
        onChange={() => onToggle(member)}
      />
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <strong className="min-w-0 flex-1 truncate" title={member.gameNickname}>
          {member.gameNickname}
        </strong>
        <span
          className="max-w-[45%] shrink-0 truncate text-xs text-muted-foreground"
          aria-label={channelNames}
          title={channelNames}
        >
          {channelNames}
        </span>
      </span>
    </label>
  )
}

function channelCounts(
  response: BroadcastRecipientsResponse | undefined,
  selectedChannels: SendableChannel[],
  excludedRecipients: ExcludedRecipient[],
) {
  const result: Partial<Record<SendableChannel, number>> = {}
  for (const channel of selectedChannels) {
    const excluded = new Set(
      excludedRecipients
        .filter((recipient) => recipient.channels.includes(channel))
        .map((recipient) => recipient.id),
    ).size
    result[channel] = Math.max(
      0,
      (response?.channels?.[channel].count ?? 0) - excluded,
    )
  }
  return result
}

export function RecipientExclusions({
  selectedChannels,
  groupId,
  eventId,
  excludedRecipients,
  onChange,
}: {
  selectedChannels: SendableChannel[]
  groupId: string | null
  eventId: string | null
  excludedRecipients: ExcludedRecipient[]
  onChange: (value: ExcludedRecipient[]) => void
}) {
  const [classId, setClassId] = useState<number | null>(null)
  const classes = useClasses()
  const recipients = useBroadcastRecipientOptions(
    selectedChannels,
    classId,
    groupId,
    eventId,
  )
  const pages = recipients.data?.pages ?? []
  const items = pages.flatMap((page) => page.items)
  const firstPage = pages[0]
  const excludedIds = new Set(
    excludedRecipients.map((recipient) => recipient.id),
  )
  const counts = channelCounts(firstPage, selectedChannels, excludedRecipients)
  const countsText = selectedChannels
    .map(
      (channel) =>
        `${BROADCAST_CHANNEL_LABELS[channel]}: ${counts[channel] ?? 0}`,
    )
    .join(', ')
  const [isBulkUpdating, setIsBulkUpdating] = useState(false)

  const toggle = (member: BroadcastRecipientOption) => {
    if (excludedIds.has(member.id)) {
      onChange(excludedRecipients.filter((item) => item.id !== member.id))
    } else {
      onChange([
        ...excludedRecipients,
        { id: member.id, channels: member.channels },
      ])
    }
  }

  const setClassExclusion = async (excluded: boolean) => {
    setIsBulkUpdating(true)
    try {
      let result = recipients
      while (result.hasNextPage) {
        result = await result.fetchNextPage({ cancelRefetch: false })
        if (result.isFetchNextPageError) {
          throw new Error('recipient_page_failed')
        }
      }

      const members = result.data?.pages.flatMap((page) => page.items) ?? []
      if (members.length === 0) {
        return
      }
      const memberIds = new Set(members.map((member) => member.id))
      if (excluded) {
        const exclusions = new Map(
          excludedRecipients.map((recipient) => [recipient.id, recipient]),
        )
        for (const member of members) {
          exclusions.set(member.id, {
            id: member.id,
            channels: member.channels,
          })
        }
        onChange([...exclusions.values()])
      } else {
        onChange(
          excludedRecipients.filter(
            (recipient) => !memberIds.has(recipient.id),
          ),
        )
      }
    } catch {
      toast.error('Не удалось загрузить получателей. Отметки не изменены.')
    } finally {
      setIsBulkUpdating(false)
    }
  }

  let content
  if (selectedChannels.length === 0) {
    content = (
      <EmptyState
        title="Выберите мессенджер"
        description="Сначала отметьте хотя бы один канал рассылки."
      />
    )
  } else if (recipients.isPending) {
    content = <LoadingState label="Загружаем получателей…" rows={3} />
  } else if (recipients.isError) {
    content = <ErrorState onRetry={() => void recipients.refetch()} />
  } else if (items.length === 0) {
    content = (
      <EmptyState
        title="Подходящих получателей нет"
        description="Сейчас никто не может получить объявление в выбранные мессенджеры."
      />
    )
  } else {
    content = (
      <ScrollableVirtualList
        key={`${classId ?? 'all'}:${selectedChannels.join(',')}`}
        label="Получатели объявления"
        items={items}
        getKey={(member) => member.id}
        estimateSize={RECIPIENT_ROW_HEIGHT}
        endPadding={RECIPIENT_END_PADDING}
        viewportRows={15}
        autoLoadMore={false}
        measureRows={false}
        paging={pagingOf(recipients)}
        renderItem={(member) => (
          <RecipientRow
            member={member}
            selectedChannels={selectedChannels}
            excluded={excludedIds.has(member.id)}
            disabled={isBulkUpdating || recipients.isFetchingNextPage}
            onToggle={toggle}
          />
        )}
      />
    )
  }

  return (
    <section
      aria-label="Исключения получателей"
      className="col-span-full grid gap-3"
    >
      <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,18rem)_max-content] sm:items-end">
        <FormField
          id="broadcast-recipient-class"
          label="Класс получателя"
          className="min-w-0"
        >
          <Select
            id="broadcast-recipient-class"
            aria-label="Класс получателя"
            disabled={isBulkUpdating || recipients.isFetchingNextPage}
            value={classId === null ? 'all' : String(classId)}
            onValueChange={(value) =>
              setClassId(value === 'all' ? null : Number(value))
            }
            options={[
              { value: 'all', label: 'Все классы' },
              ...(classes.data ?? []).map((item) => ({
                value: String(item.id),
                label: item.name,
              })),
            ]}
          />
        </FormField>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={
              selectedChannels.length === 0 ||
              recipients.isPending ||
              recipients.isError ||
              recipients.isFetchingNextPage ||
              isBulkUpdating ||
              items.length === 0
            }
            onClick={() => void setClassExclusion(true)}
          >
            Снять отметки
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={
              selectedChannels.length === 0 ||
              recipients.isPending ||
              recipients.isError ||
              recipients.isFetchingNextPage ||
              isBulkUpdating ||
              items.length === 0
            }
            onClick={() => void setClassExclusion(false)}
          >
            Отметить всех
          </Button>
        </div>
      </div>
      {content}
      {selectedChannels.length > 0 && firstPage ? (
        <p aria-live="polite" className="m-0 text-sm text-muted-foreground">
          Получателей по каналам: {countsText}
        </p>
      ) : null}
    </section>
  )
}
