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
import { Select } from '@/components/ui/select'
import { pagingOf, ScrollableVirtualList } from '@/components/virtual-list'
import { cn } from '@/lib/utils'
import { useClasses } from '@/features/catalog/use-classes'
import { useBroadcastRecipientOptions } from './api'

export type ExcludedRecipient = {
  id: string
  channels: SendableChannel[]
}

function RecipientRow({
  member,
  selectedChannels,
  excluded,
  onToggle,
}: {
  member: BroadcastRecipientOption
  selectedChannels: SendableChannel[]
  excluded: boolean
  onToggle: (member: BroadcastRecipientOption) => void
}) {
  const channelNames = member.channels
    .filter((channel) => selectedChannels.includes(channel))
    .map((channel) => BROADCAST_CHANNEL_LABELS[channel])
    .join(' · ')

  return (
    <label
      className={cn(
        'flex h-16 min-w-0 cursor-pointer items-center gap-3 overflow-hidden rounded-lg border border-border bg-surface-inset px-3 py-2.5',
        excluded && 'border-highlight-line bg-item-highlight!',
      )}
    >
      <input
        type="checkbox"
        className="size-4 flex-none accent-primary"
        aria-label={`Получит: ${member.gameNickname}`}
        checked={!excluded}
        onChange={() => onToggle(member)}
      />
      <span className="grid min-w-0 flex-1 gap-1">
        <strong className="min-w-0 truncate" title={member.gameNickname}>
          {member.gameNickname}
        </strong>
        <span
          className="truncate text-xs text-muted-foreground"
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
        estimateSize={64}
        endPadding={64}
        viewportRows={15}
        autoLoadMore={false}
        measureRows={false}
        paging={pagingOf(recipients)}
        renderItem={(member) => (
          <RecipientRow
            member={member}
            selectedChannels={selectedChannels}
            excluded={excludedIds.has(member.id)}
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
      <div className="grid gap-1">
        <h2 className="m-0 text-base font-semibold">Кому отправить</h2>
        <p className="m-0 text-sm text-muted-foreground">
          Все подходящие участники отмечены. Снимите отметку, чтобы не
          отправлять человеку это объявление ни в один выбранный мессенджер.
        </p>
      </div>
      <FormField id="broadcast-recipient-class" label="Класс получателя">
        <Select
          id="broadcast-recipient-class"
          aria-label="Класс получателя"
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
      <p className="m-0 text-sm text-muted-foreground">
        Фильтр помогает найти участников; на отправку влияют только снятые
        отметки.
      </p>
      {content}
      {selectedChannels.length > 0 && firstPage ? (
        <p aria-live="polite" className="m-0 text-sm text-muted-foreground">
          Получателей по каналам: {countsText}
        </p>
      ) : null}
    </section>
  )
}
