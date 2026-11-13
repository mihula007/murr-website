import { useState } from 'react'
import type { RatingRow } from '@contracts/activity'
import { MEMBER_LIST_LIMIT } from '@contracts/paging'
import { EmptyState } from '@/components/states/empty-state'
import { ErrorState } from '@/components/states/error-state'
import { LoadingState } from '@/components/states/loading-state'
import { PageHeader } from '@/components/states/page-header'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/surfaces'
import { ClassIcon } from '@/features/catalog/class-icon'
import { useAttendanceRating } from './api'
import {
  activityColumns,
  DataTable,
  sortByText,
  type ActivityColumns,
} from './data-table'

const column = activityColumns<RatingRow>()

/** Неизвестное значение — «—» (ACT-15). */
const orDash = (value: number | null, suffix = '') =>
  value === null ? '—' : `${value}${suffix}`

const columns: ActivityColumns<RatingRow> = column.columns([
  column.accessor('gameNickname', {
    header: 'Участник',
    sortFn: sortByText((row: RatingRow) => row.gameNickname),
    cell: (info) => (
      <strong className="break-words text-foreground">{info.getValue()}</strong>
    ),
  }),
  column.accessor('className', {
    header: 'Класс',
    sortFn: sortByText((row: RatingRow) => row.className),
    cell: (info) => (
      <span className="inline-flex items-center gap-1.5">
        <ClassIcon
          classId={info.row.original.classId}
          className={info.getValue()}
        />
        {info.getValue()}
      </span>
    ),
  }),
  column.accessor('visited', { header: 'Посетил', sortFn: 'basic' }),
  column.accessor('missed', { header: 'Не посетил', sortFn: 'basic' }),
  column.accessor('unmarked', { header: 'Не отметился', sortFn: 'basic' }),
  column.accessor((row) => row.percent ?? -1, {
    id: 'percent',
    header: 'Посещения',
    sortFn: 'basic',
    cell: (info) => (
      <strong className="text-primary tabular-nums">
        {orDash(info.row.original.percent, '%')}
      </strong>
    ),
  }),
  column.accessor('leaderCount', { header: 'Пати-лидер', sortFn: 'basic' }),
  column.accessor((row) => row.daysInGuild ?? -1, {
    id: 'daysInGuild',
    header: 'Дней в гильдии',
    sortFn: 'basic',
    cell: (info) => orDash(info.row.original.daysInGuild),
  }),
])

/**
 * Рейтинг посещения (ACT-14–16): текущий состав по закрытым событиям,
 * поиск по участнику и сортировка по каждому столбцу. Видят все внутренние
 * роли (01-roles).
 */
export function RatingPage() {
  const rating = useAttendanceRating()
  const [search, setSearch] = useState('')

  let content
  if (rating.isPending) {
    content = <LoadingState label="Загружаем рейтинг…" />
  } else if (rating.isError) {
    content = <ErrorState onRetry={() => void rating.refetch()} />
  } else {
    const query = search.trim().toLocaleLowerCase('ru-RU')
    const rows = rating.data.items.filter(
      (row) =>
        !query ||
        `${row.gameNickname} ${row.className}`
          .toLocaleLowerCase('ru-RU')
          .includes(query),
    )
    content = (
      <Card className="grid gap-3">
        <div className="grid items-end gap-3 min-[700px]:grid-cols-[minmax(0,1fr)_minmax(220px,320px)]">
          <div className="grid gap-1">
            <h2 className="m-0 text-base font-bold text-foreground">
              Посещение событий
            </h2>
            <p className="m-0 text-sm text-muted-foreground">
              Учитываются завершённые события: {rating.data.eventCount}. Процент
              — от событий, в которых участник был в составе.
            </p>
          </div>
          <Input
            type="search"
            aria-label="Поиск по участнику"
            placeholder="Поиск по нику или классу"
            value={search}
            onChange={(change) => setSearch(change.target.value)}
          />
        </div>
        <DataTable
          label="Рейтинг посещения"
          columns={columns}
          data={rows}
          getRowId={(row) => row.userId}
          sortable
          numbered
          empty={
            <EmptyState
              title={query ? 'Никого не нашли' : 'Участников пока нет'}
              description={
                query
                  ? 'Измените поиск.'
                  : 'Рейтинг появится, когда в составе будут участники.'
              }
            />
          }
        />
        {rating.data.truncated ? (
          <output className="text-sm text-muted-foreground">
            Показаны первые {MEMBER_LIST_LIMIT} участников.
          </output>
        ) : null}
      </Card>
    )
  }

  return (
    <section>
      <PageHeader
        title="Рейтинг посещения"
        description="Посещения, пропуски и пати-лидерство участников клана."
      />
      {content}
    </section>
  )
}
