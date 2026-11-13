import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { FileSpreadsheet, RotateCcw } from 'lucide-react'
import { z } from 'zod'
import type {
  ActivityEventOption,
  ActivityHistoryRow,
  ActivityMemberResponse,
  ActivitySummaryRow,
} from '@contracts/activity'
import { eventDateSchema } from '@contracts/events'
import {
  ATTENDANCE_STATUS_LABELS,
  type AttendanceStatus,
} from '@contracts/groups'
import { MEMBER_LIST_LIMIT } from '@contracts/paging'
import { FormField } from '@/components/form/form-field'
import { EmptyState } from '@/components/states/empty-state'
import { ErrorState } from '@/components/states/error-state'
import { LoadingState } from '@/components/states/loading-state'
import { PageHeader } from '@/components/states/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge, Card } from '@/components/ui/surfaces'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from '@/components/ui/toaster'
import { pagingOf, VirtualList } from '@/components/virtual-list'
import { ClassIcon } from '@/features/catalog/class-icon'
import { useClasses } from '@/features/catalog/use-classes'
import { errorMessage, type AppError } from '@/lib/errors'
import { formatDate } from '@/lib/format-date'
import { cn } from '@/lib/utils'
import {
  useActivityEvent,
  useActivityEvents,
  useActivityHistory,
  useActivityMember,
  useActivitySummary,
  type ActivityFilters,
} from './api'
import {
  activityColumns,
  DataTable,
  VirtualDataTable,
  type ActivityColumns,
} from './data-table'
import { exportActivityWorkbook, matchesSearch } from './export-workbook'

const VIEWS = ['summary', 'history', 'event', 'member'] as const
type View = (typeof VIEWS)[number]
const VIEW_LABELS: Record<View, string> = {
  summary: 'Сводка',
  history: 'История',
  event: 'По ивенту',
  member: 'По участнику',
}

/** Фильтры и выбор в адресе: ссылка открывает тот же учёт (списки, ACT-09). */
export const activitySearchSchema = z.object({
  view: z.enum(VIEWS).catch('summary'),
  from: eventDateSchema.optional().catch(undefined),
  to: eventDateSchema.optional().catch(undefined),
  classId: z.number().int().positive().optional().catch(undefined),
  q: z.string().max(40).optional().catch(undefined),
  eventId: z.guid().optional().catch(undefined),
  userId: z.guid().optional().catch(undefined),
})
export type ActivitySearch = z.output<typeof activitySearchSchema>

const ALL = 'all'
const sectionTitleClass = 'm-0 text-base font-bold text-foreground'

const STATUS_CLASS: Record<AttendanceStatus, string> = {
  visited: 'text-primary',
  missed: 'text-destructive',
  unmarked: 'text-muted-foreground',
}

function StatusCell({ status }: { status: AttendanceStatus }) {
  return (
    <span className={cn('font-semibold', STATUS_CLASS[status])}>
      {ATTENDANCE_STATUS_LABELS[status]}
    </span>
  )
}

function NameCell({ name, isReader }: { name: string; isReader: boolean }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <strong className="break-words text-foreground">{name}</strong>
      {isReader ? (
        <Badge className="border-border text-muted-foreground">Чтец</Badge>
      ) : null}
    </span>
  )
}

function ClassCell({ classId, name }: { classId: number; name: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <ClassIcon classId={classId} className={name} />
      {name}
    </span>
  )
}

const summaryColumn = activityColumns<ActivitySummaryRow>()
const summaryColumns: ActivityColumns<ActivitySummaryRow> =
  summaryColumn.columns([
    summaryColumn.accessor('gameNickname', {
      header: 'Участник',
      cell: (info) => (
        <NameCell
          name={info.getValue()}
          isReader={info.row.original.isReader}
        />
      ),
    }),
    summaryColumn.accessor('className', {
      header: 'Класс',
      cell: (info) => (
        <ClassCell classId={info.row.original.classId} name={info.getValue()} />
      ),
    }),
    summaryColumn.accessor('visited', { header: 'Посетил' }),
    summaryColumn.accessor('missed', { header: 'Не посетил' }),
    summaryColumn.accessor('unmarked', { header: 'Не отметился' }),
    summaryColumn.accessor('percent', {
      header: 'Посещения',
      // Без записей процент не определён: «—», как в рейтинге (ACT-15).
      cell: (info) => {
        const row = info.row.original
        const total = row.visited + row.missed + row.unmarked
        return (
          <strong className="text-primary tabular-nums">
            {total === 0 ? '—' : `${info.getValue()}%`}
          </strong>
        )
      },
    }),
  ])

const historyColumn = activityColumns<ActivityHistoryRow>()
const historyColumns: ActivityColumns<ActivityHistoryRow> =
  historyColumn.columns([
    historyColumn.accessor('dateMsk', {
      header: 'Дата',
      cell: (info) => formatDate(info.getValue()),
    }),
    historyColumn.accessor('eventTitle', {
      header: 'Ивент',
      cell: (info) => <span className="break-words">{info.getValue()}</span>,
    }),
    historyColumn.accessor('gameNickname', {
      header: 'Участник',
      cell: (info) => (
        <NameCell
          name={info.getValue()}
          isReader={info.row.original.isReader}
        />
      ),
    }),
    historyColumn.accessor('className', {
      header: 'Класс',
      cell: (info) => (
        <ClassCell classId={info.row.original.classId} name={info.getValue()} />
      ),
    }),
    historyColumn.accessor('groupName', {
      header: 'Группа',
      cell: (info) => info.getValue() ?? '—',
    }),
    historyColumn.accessor('status', {
      header: 'Посещение',
      cell: (info) => <StatusCell status={info.getValue()} />,
    }),
  ])

type EventRow = Omit<
  ActivityHistoryRow,
  'eventId' | 'eventTitle' | 'startsAt' | 'dateMsk'
>
const eventRowColumn = activityColumns<EventRow>()
const eventRowColumns: ActivityColumns<EventRow> = eventRowColumn.columns([
  eventRowColumn.accessor('gameNickname', {
    header: 'Участник',
    cell: (info) => (
      <NameCell
        name={`${info.getValue()}${info.row.original.isLeader ? ' — Пати лидер' : ''}`}
        isReader={info.row.original.isReader}
      />
    ),
  }),
  eventRowColumn.accessor('className', {
    header: 'Класс',
    cell: (info) => (
      <ClassCell classId={info.row.original.classId} name={info.getValue()} />
    ),
  }),
  eventRowColumn.accessor('groupName', {
    header: 'Группа',
    cell: (info) => info.getValue() ?? '—',
  }),
  eventRowColumn.accessor('status', {
    header: 'Посещение',
    cell: (info) => <StatusCell status={info.getValue()} />,
  }),
])

type MemberRow = ActivityMemberResponse['items'][number]
const memberColumn = activityColumns<MemberRow>()
const memberColumns: ActivityColumns<MemberRow> = memberColumn.columns([
  memberColumn.accessor('eventTitle', {
    header: 'Ивент',
    cell: (info) => (
      <strong className="break-words text-foreground">{info.getValue()}</strong>
    ),
  }),
  memberColumn.accessor('dateMsk', {
    header: 'Дата',
    cell: (info) => formatDate(info.getValue()),
  }),
  memberColumn.accessor('groupName', {
    header: 'Группа',
    cell: (info) =>
      info.getValue()
        ? `${info.getValue()}${info.row.original.isLeader ? ' (лидер)' : ''}`
        : '—',
  }),
  memberColumn.accessor('status', {
    header: 'Посещение',
    cell: (info) => <StatusCell status={info.getValue()} />,
  }),
])

/** Показатели «всего / посетили / не посетили / не отметились». */
function Stats({ items }: { items: [string, number | string][] }) {
  return (
    <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
      {items.map(([label, value]) => (
        <li
          key={label}
          className="rounded-lg border border-border bg-surface-inset px-3 py-1.5 text-sm text-muted-foreground"
        >
          <strong className="text-foreground tabular-nums">{value}</strong>{' '}
          {label}
        </li>
      ))}
    </ul>
  )
}

type PanelProps = { filters: ActivityFilters; search: string | null }

function SummaryPanel({ filters, search }: PanelProps) {
  const summary = useActivitySummary(filters)
  if (summary.isPending) {
    return <LoadingState label="Считаем сводку…" />
  }
  if (summary.isError) {
    return <ErrorState onRetry={() => void summary.refetch()} />
  }
  const rows = summary.data.items.filter((row) => matchesSearch(row, search))
  return (
    <div className="grid gap-3">
      <p className="m-0 text-sm text-muted-foreground">
        Участников: {rows.length} · ивентов в периоде: {summary.data.eventCount}
      </p>
      <DataTable
        label="Сводка участников"
        columns={summaryColumns}
        data={rows}
        getRowId={(row) => row.userId}
        empty={
          <EmptyState
            title="Нет данных"
            description="Пока нет участников или записей для выбранных фильтров."
          />
        }
      />
      {summary.data.truncated ? (
        <output className="text-sm text-muted-foreground">
          Показаны первые {MEMBER_LIST_LIMIT} участников.
        </output>
      ) : null}
    </div>
  )
}

function HistoryPanel({ filters, search }: PanelProps) {
  const history = useActivityHistory({ ...filters, search }, true)
  if (history.isPending) {
    return <LoadingState label="Загружаем историю…" />
  }
  if (history.isError) {
    return <ErrorState onRetry={() => void history.refetch()} />
  }
  return (
    <VirtualDataTable
      label="История ивентов"
      columns={historyColumns}
      data={history.data.pages.flatMap((page) => page.items)}
      getRowId={(row) => `${row.eventId}:${row.userId}`}
      paging={pagingOf(history)}
      empty={
        <EmptyState
          title="Нет записей"
          description="Нет закрытых ивентов для выбранных фильтров."
        />
      }
    />
  )
}

function EventDetails({
  eventId,
  classId,
  search,
  onBack,
}: {
  eventId: string
  classId: number | null
  search: string | null
  onBack: () => void
}) {
  const event = useActivityEvent(eventId, classId)
  if (event.isPending) {
    return <LoadingState label="Загружаем ивент…" />
  }
  if (event.isError) {
    return <ErrorState onRetry={() => void event.refetch()} />
  }
  const query = (search ?? '').trim().toLocaleLowerCase('ru-RU')
  const rows = event.data.rows.filter(
    (row) =>
      !query ||
      `${row.gameNickname} ${row.className} ${row.groupName ?? ''}`
        .toLocaleLowerCase('ru-RU')
        .includes(query),
  )
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="m-0 min-w-0 flex-1 text-base font-bold break-words">
          {event.data.event.title} · {formatDate(event.data.event.dateMsk)}
        </h3>
        <Button type="button" variant="secondary" size="sm" onClick={onBack}>
          Другой ивент
        </Button>
      </div>
      <Stats
        items={[
          ['участников', event.data.counts.total],
          ['посетили', event.data.counts.visited],
          ['не посетили', event.data.counts.missed],
          ['не отметились', event.data.counts.unmarked],
        ]}
      />
      <DataTable
        label="Состав ивента"
        columns={eventRowColumns}
        data={rows}
        getRowId={(row) => row.userId}
        empty={
          <EmptyState
            title="Нет записей"
            description="Нет записей по выбранному ивенту и фильтрам."
          />
        }
      />
    </div>
  )
}

function EventPanel({
  filters,
  search,
  eventId,
  onSelect,
}: PanelProps & {
  eventId: string | null
  onSelect: (id: string | undefined) => void
}) {
  const events = useActivityEvents(
    { from: filters.from, to: filters.to, search },
    eventId === null,
  )
  if (eventId) {
    return (
      <EventDetails
        eventId={eventId}
        classId={filters.classId}
        search={search}
        onBack={() => onSelect(undefined)}
      />
    )
  }
  if (events.isPending) {
    return <LoadingState label="Загружаем ивенты…" />
  }
  if (events.isError) {
    return <ErrorState onRetry={() => void events.refetch()} />
  }
  const items = events.data.pages.flatMap((page) => page.items)
  if (items.length === 0) {
    return (
      <EmptyState
        title="Нет закрытых ивентов"
        description="В выбранном периоде нет закрытых ивентов."
      />
    )
  }
  return (
    <div className="grid gap-2">
      <p className="m-0 text-sm text-muted-foreground">
        Выберите ивент: показаны новые сверху.
      </p>
      <VirtualList<ActivityEventOption>
        label="Закрытые ивенты"
        items={items}
        getKey={(item) => item.id}
        estimateSize={52}
        paging={pagingOf(events)}
        renderItem={(item) => (
          <button
            type="button"
            className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg border border-border bg-surface-inset px-3 py-2.5 text-left text-foreground hover:border-primary"
            onClick={() => onSelect(item.id)}
          >
            <strong className="min-w-0 break-words">{item.title}</strong>
            <span className="flex-none text-sm text-muted-foreground">
              {formatDate(item.dateMsk)}
            </span>
          </button>
        )}
      />
    </div>
  )
}

function MemberPanel({
  filters,
  userId,
  onSelect,
}: PanelProps & {
  userId: string | null
  onSelect: (id: string | undefined) => void
}) {
  const summary = useActivitySummary(filters)
  const member = useActivityMember(userId, filters)
  const options = [...(summary.data?.items ?? [])].sort((a, b) =>
    a.gameNickname.localeCompare(b.gameNickname, 'ru-RU'),
  )

  let details
  if (userId === null) {
    details = (
      <p className="m-0 text-muted-foreground">
        Выберите участника, чтобы увидеть его показатели и историю.
      </p>
    )
  } else if (member.isPending) {
    details = <LoadingState label="Загружаем историю участника…" />
  } else if (member.isError) {
    details = <ErrorState onRetry={() => void member.refetch()} />
  } else {
    const stats = member.data.pages[0]!.stats
    details = (
      <div className="grid gap-3">
        <Stats
          items={[
            ['ивентов', stats.total],
            ['посетил', stats.visited],
            ['не посетил', stats.missed],
            ['не отметился', stats.unmarked],
            ['посещения', stats.total === 0 ? '—' : `${stats.percent}%`],
          ]}
        />
        <VirtualDataTable
          label="История участника"
          columns={memberColumns}
          data={member.data.pages.flatMap((page) => page.items)}
          getRowId={(row) => row.eventId}
          paging={pagingOf(member)}
          empty={
            <EmptyState
              title="Нет записей"
              description="У участника нет записей для выбранных фильтров."
            />
          }
        />
      </div>
    )
  }

  return (
    <div className="grid gap-3">
      <FormField id="activity-member" label="Участник" className="max-w-md">
        <Select
          id="activity-member"
          placeholder="Выберите участника"
          value={userId ?? undefined}
          onValueChange={(value) => onSelect(value)}
          options={options.map((row) => ({
            value: row.userId,
            label: `${row.gameNickname} · ${row.className}${row.isReader ? ' · чтец' : ''}`,
          }))}
        />
      </FormField>
      {details}
    </div>
  )
}

/** Поиск с задержкой перед запросом и записью в адрес. */
function useDebounced(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

/**
 * «Учёт активности» (ACT-04–11): сводка, история, по мероприятию и по
 * участнику с общими фильтрами периода, класса и поиска; выгрузка Excel
 * с теми же фильтрами (Q-18). Только офицер и администратор (Q-25).
 */
export function ActivityPage(search: Partial<ActivitySearch>) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const classes = useClasses()
  const view = search.view ?? 'summary'
  const [text, setText] = useState(search.q ?? '')
  const debounced = useDebounced(text, 350)
  const [exporting, setExporting] = useState(false)
  const filters: ActivityFilters = {
    from: search.from ?? null,
    to: search.to ?? null,
    classId: search.classId ?? null,
  }
  const query = search.q?.trim() || null
  const periodError =
    filters.from && filters.to && filters.from > filters.to
      ? 'Дата «по» раньше даты «с»'
      : null

  const go = (patch: Partial<ActivitySearch>) =>
    void navigate({
      to: '/activity',
      search: (previous) => ({ ...previous, ...patch }),
      replace: true,
    })

  useEffect(() => {
    if ((search.q ?? '') !== debounced) {
      go({ q: debounced || undefined })
    }
    // Адрес обновляется только при смене введённого текста.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced])

  async function exportExcel() {
    setExporting(true)
    try {
      const result = await exportActivityWorkbook(queryClient, filters, query)
      toast(
        result.truncated
          ? `Выгружено с ограничением: ${result.history} строк истории`
          : `Excel выгружен: ${result.summary} участников, ${result.history} строк истории`,
      )
    } catch (error) {
      toast(errorMessage((error as AppError).code ?? 'unknown'))
    } finally {
      setExporting(false)
    }
  }

  let panel
  if (periodError) {
    panel = <ErrorState title="Проверьте период" message={periodError} />
  } else if (view === 'summary') {
    panel = <SummaryPanel filters={filters} search={query} />
  } else if (view === 'history') {
    panel = <HistoryPanel filters={filters} search={query} />
  } else if (view === 'event') {
    panel = (
      <EventPanel
        filters={filters}
        search={query}
        eventId={search.eventId ?? null}
        onSelect={(eventId) => go({ eventId })}
      />
    )
  } else {
    panel = (
      <MemberPanel
        filters={filters}
        search={query}
        userId={search.userId ?? null}
        onSelect={(userId) => go({ userId })}
      />
    )
  }

  return (
    <section>
      <PageHeader
        title="Учёт активности"
        description="Посещение закрытых ивентов: в группе — «Посетил», вне группы с ответом — «Не посетил», без ответа — «Не отметился»."
      />
      <Card className="mb-4 grid gap-3">
        <h2 className={sectionTitleClass}>Фильтры</h2>
        <div className="grid items-end gap-3 min-[700px]:grid-cols-2 min-[1100px]:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
          <FormField id="activity-from" label="Период с (МСК)">
            <Input
              id="activity-from"
              type="date"
              value={search.from ?? ''}
              onChange={(change) =>
                go({ from: change.target.value || undefined })
              }
            />
          </FormField>
          <FormField
            id="activity-to"
            label="Период по (МСК)"
            error={periodError}
          >
            <Input
              id="activity-to"
              type="date"
              aria-invalid={periodError ? true : undefined}
              value={search.to ?? ''}
              onChange={(change) =>
                go({ to: change.target.value || undefined })
              }
            />
          </FormField>
          <FormField id="activity-class" label="Класс">
            <Select
              id="activity-class"
              value={search.classId ? String(search.classId) : ALL}
              onValueChange={(value) =>
                go({ classId: value === ALL ? undefined : Number(value) })
              }
              options={[
                { value: ALL, label: 'Все классы' },
                ...(classes.data ?? []).map((item) => ({
                  value: String(item.id),
                  label: item.name,
                })),
              ]}
            />
          </FormField>
          <FormField id="activity-search" label="Поиск">
            <Input
              id="activity-search"
              type="search"
              placeholder="Участник или ивент"
              maxLength={40}
              value={text}
              onChange={(change) => setText(change.target.value)}
            />
          </FormField>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setText('')
              go({
                from: undefined,
                to: undefined,
                classId: undefined,
                q: undefined,
              })
            }}
          >
            <RotateCcw size={16} aria-hidden="true" /> Сбросить
          </Button>
        </div>
        <Button
          type="button"
          className="justify-self-start max-xs:w-full max-xs:justify-self-stretch"
          disabled={exporting || periodError !== null}
          onClick={() => void exportExcel()}
        >
          <FileSpreadsheet size={18} aria-hidden="true" />
          {exporting ? 'Готовим файл…' : 'Выгрузить Excel'}
        </Button>
      </Card>
      <Tabs value={view} onValueChange={(value) => go({ view: value as View })}>
        <TabsList
          aria-label="Представление учёта"
          className="mb-4 flex-wrap overflow-visible max-xs:grid max-xs:grid-cols-2"
        >
          {VIEWS.map((item) => (
            <TabsTrigger key={item} value={item}>
              {VIEW_LABELS[item]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <Card>{panel}</Card>
    </section>
  )
}
