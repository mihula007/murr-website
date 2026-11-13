import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { CalendarPlus, Plus } from 'lucide-react'
import { z } from 'zod'
import {
  EVENT_TABS,
  RECURRING_PRESET_IDS,
  RECURRING_PRESETS,
} from '@contracts/events'
import { SMALL_LIST_LIMIT } from '@contracts/paging'
import { hasRole, MANAGER_ROLES, useAccess } from '@/app/access'
import { EmptyState } from '@/components/states/empty-state'
import { ErrorState } from '@/components/states/error-state'
import { LoadingState } from '@/components/states/loading-state'
import { PageHeader } from '@/components/states/page-header'
import { Button, buttonVariants } from '@/components/ui/button'
import { NavBadge } from '@/components/ui/nav-badge'
import { Card } from '@/components/ui/surfaces'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from '@/components/ui/toaster'
import { pagingOf, VirtualList } from '@/components/virtual-list'
import { errorMessage, type AppError } from '@/lib/errors'
import { formatWeekdayTimeMsk } from '@/lib/format-date'
import { cn } from '@/lib/utils'
import { GroupTemplatesDialog } from './groups/group-templates-dialog'
import { useActiveEvents, useEnsureWeeklyEvents, usePastEvents } from './api'
import { EventCard } from './event-card'

/** Параметры адреса: неизвестная вкладка — «Актуальные». */
export const eventsSearchSchema = z.object({
  tab: z.enum(EVENT_TABS).catch('active'),
})
export type EventsSearch = z.output<typeof eventsSearchSchema>

/** Сетка карточек: 1 колонка на узком экране, 2 — от 900 px. */
const gridClass = 'grid-cols-1 min-[900px]:grid-cols-2'

const EMPTY = {
  active: {
    title: 'Актуальных событий нет',
    description: 'Новые события появятся здесь.',
  },
  past: {
    title: 'Прошедших событий нет',
    description: 'Здесь появятся закрытые события.',
  },
} as const

const sectionTitleClass = 'm-0 text-base font-bold text-foreground'

/**
 * Постоянные события создаются расписанием по понедельникам в 00:00 МСК;
 * кнопка — запасной путь: создаёт только недостающие выпуски (Q-42).
 */
function WeeklyEvents() {
  const ensure = useEnsureWeeklyEvents()
  const [templates, setTemplates] = useState(false)

  async function run() {
    try {
      const result = await ensure.mutateAsync()
      toast(
        result.created.length === 0
          ? 'Все постоянные события недели уже созданы'
          : `Создано событий: ${result.created.length}, уже были: ${result.existing.length}`,
      )
    } catch (error) {
      toast(errorMessage((error as AppError).code))
    }
  }

  return (
    <Card className="mb-4 grid gap-3">
      <div className="grid gap-1">
        <h2 className={sectionTitleClass}>Постоянные события</h2>
        <p className="m-0 text-sm text-muted-foreground">
          Создаются автоматически каждый понедельник в 00:00 МСК. Кнопка создаёт
          только недостающие ближайшие выпуски.
        </p>
      </div>
      <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0 min-[900px]:grid-cols-4">
        {RECURRING_PRESET_IDS.map((id) => {
          const preset = RECURRING_PRESETS[id]
          return (
            <li
              key={id}
              className="grid gap-0.5 rounded-lg border border-border bg-surface-inset px-3 py-2"
            >
              <strong>{preset.title}</strong>
              <span className="text-xs text-muted-foreground first-letter:uppercase">
                {formatWeekdayTimeMsk(preset.weekday, preset.time)}
              </span>
            </li>
          )
        })}
      </ul>
      <div className="flex flex-wrap gap-2 max-xs:grid">
        <Button
          type="button"
          variant="secondary"
          disabled={ensure.isPending}
          onClick={() => void run()}
        >
          <CalendarPlus size={18} aria-hidden="true" />
          {ensure.isPending ? 'Создаём…' : 'Создать постоянные события недели'}
        </Button>
        {/* Библиотека групп открывается и из расписания (GRP-12). */}
        <Button
          type="button"
          variant="secondary"
          onClick={() => setTemplates(true)}
        >
          Шаблоны групп
        </Button>
      </div>
      <GroupTemplatesDialog open={templates} onOpenChange={setTemplates} />
    </Card>
  )
}

/** Раздел «События»: актуальные и прошедшие события (EVT-01). */
// Типы поиска TanStack Router в компоненте маршрута необязательны: значения
// по умолчанию — те же, что у схемы.
export function EventsPage({ tab = 'active' }: Partial<EventsSearch>) {
  const navigate = useNavigate()
  const { role } = useAccess()
  const isManager = hasRole(role, MANAGER_ROLES)
  // Счётчики нужны на обеих вкладках: список актуальных малый и кэшируется.
  const active = useActiveEvents()
  const past = usePastEvents(tab === 'past')
  const pastItems = past.data?.pages.flatMap((page) => page.items)
  const list = tab === 'active' ? active : past

  let content
  if (list.isPending) {
    content = <LoadingState label="Загружаем события…" />
  } else if (list.isError) {
    content = <ErrorState onRetry={() => void list.refetch()} />
  } else if (tab === 'active' && active.data) {
    content =
      active.data.items.length === 0 ? (
        <EmptyState {...EMPTY.active} />
      ) : (
        <>
          <ul
            aria-label="Актуальные события"
            className={`m-0 grid list-none gap-3 p-0 ${gridClass}`}
          >
            {active.data.items.map((event) => (
              <li key={event.id} className="min-w-0">
                <EventCard event={event} className="h-full" />
              </li>
            ))}
          </ul>
          {active.data.truncated ? (
            <output className="mt-3 block text-sm text-muted-foreground">
              Показаны {SMALL_LIST_LIMIT} ближайших событий. Закройте или
              удалите прошедшие, чтобы увидеть остальные.
            </output>
          ) : null}
        </>
      )
  } else if (!pastItems || pastItems.length === 0) {
    content = <EmptyState {...EMPTY.past} />
  } else {
    content = (
      <VirtualList
        label="Прошедшие события"
        items={pastItems}
        getKey={(event) => event.id}
        estimateSize={260}
        columns={1}
        gap="md"
        paging={pagingOf(past)}
        renderItem={(event) => <EventCard event={event} />}
      />
    )
  }

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader
          title="События"
          description="Расписание клана: отвечайте «Приду», «Не приду» или «50/50» до начала события. Время — московское."
        />
        {isManager ? (
          <Link
            to="/events/new"
            className={cn(buttonVariants(), 'mb-4 no-underline max-xs:w-full')}
          >
            <Plus size={18} aria-hidden="true" /> Создать событие
          </Link>
        ) : null}
      </div>
      {isManager ? <WeeklyEvents /> : null}
      <Tabs
        value={tab}
        onValueChange={(value) =>
          void navigate({
            to: '/events',
            search: { tab: value === 'past' ? 'past' : 'active' },
          })
        }
      >
        <TabsList aria-label="События" className="mb-4">
          <TabsTrigger
            value="active"
            className="inline-flex items-center gap-2"
          >
            Актуальные
            <NavBadge count={active.data?.activeCount} />
          </TabsTrigger>
          <TabsTrigger value="past" className="inline-flex items-center gap-2">
            Прошедшие
            {active.data ? (
              <span className="text-xs text-muted-foreground tabular-nums">
                {active.data.pastCount}
              </span>
            ) : null}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {content}
    </section>
  )
}
