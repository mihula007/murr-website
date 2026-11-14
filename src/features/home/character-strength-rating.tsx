import { useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import {
  useTable,
  type OnChangeFn,
  type SortingState,
} from '@tanstack/react-table'
import type { RosterMember } from '@contracts/roster'
import {
  CHARACTER_STAT_FIELDS,
  CHARACTER_STAT_LABELS,
  type CharacterStatNumberField,
} from '@contracts/character-stats'
import { ErrorState } from '@/components/states/error-state'
import { LoadingState } from '@/components/states/loading-state'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import {
  activityColumns,
  activityTableFeatures,
  type ActivityColumns,
} from '@/features/activity/data-table'
import { ClassIcon } from '@/features/catalog/class-icon'
import { useRoster } from '@/features/roster/api'
import { formatCharacterStat } from '@/features/roster/character-stats'
import { EmptyState } from '@/components/states/empty-state'

const fields = CHARACTER_STAT_FIELDS
const column = activityColumns<RosterMember>()
const columns: ActivityColumns<RosterMember> = [
  column.accessor('gameNickname', {
    header: 'Ник',
    cell: (info) => <strong className="break-words">{info.getValue()}</strong>,
  }),
  column.accessor('className', {
    header: 'Класс',
    cell: (info) => {
      const member = info.row.original
      return (
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <ClassIcon classId={member.classId} className={member.className} />
          {member.className}
        </span>
      )
    },
  }),
  ...fields.map((field) =>
    column.accessor((member) => member[field] ?? undefined, {
      id: field,
      header: CHARACTER_STAT_LABELS[field],
      sortDescFirst: true,
      sortUndefined: 'last',
      sortFn: 'basic',
      cell: (info) => formatCharacterStat(field, info.getValue()),
    }),
  ),
]

const tableClass =
  'w-full table-fixed border-collapse text-left text-sm [&_td]:border-b [&_td]:border-border [&_td]:px-2 [&_td]:py-2.5 [&_td]:align-middle [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:border-b [&_th]:border-border [&_th]:bg-surface-to [&_th]:px-2 [&_th]:py-2.5 [&_th]:font-semibold [&_th]:text-muted-foreground [&_th:first-child]:w-10 max-[900px]:block max-[900px]:[&_thead]:hidden max-[900px]:[&_tbody]:grid max-[900px]:[&_tbody]:gap-2.5 max-[900px]:[&_tr]:grid max-[900px]:[&_tr]:grid-cols-[auto_minmax(0,1fr)] max-[900px]:[&_tr]:gap-x-3 max-[900px]:[&_tr]:rounded-xl max-[900px]:[&_tr]:border max-[900px]:[&_tr]:border-border max-[900px]:[&_tr]:p-3 max-[900px]:[&_td]:grid max-[900px]:[&_td]:gap-0.5 max-[900px]:[&_td]:border-0 max-[900px]:[&_td]:p-0 max-[900px]:[&_td:first-child]:col-span-1 max-[900px]:[&_td:nth-child(2)]:col-span-1 max-[900px]:[&_td:nth-child(3)]:col-span-full'

const scrollClass =
  'max-h-[900px] min-w-0 overflow-y-auto overscroll-contain rounded-xl border border-border max-[900px]:max-h-[2300px]'

function MobileLabel({ text, first }: { text: string; first: boolean }) {
  return (
    <span
      className={`hidden text-xs text-muted-foreground max-[900px]:inline${first ? ' max-[900px]:hidden' : ''}`}
    >
      {text}
    </span>
  )
}

/** Рейтинг силы использует общий roster/list кеш; дополнительных вызовов нет. */
export function CharacterStrengthRating() {
  const roster = useRoster()
  const [classId, setClassId] = useState<number | null>(null)
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'pa', desc: true },
  ])
  const rosterItems = roster.data?.items ?? []
  const members = rosterItems.filter(
    (member) => classId === null || member.classId === classId,
  )
  const ratingTable = useRatingTable(members, sorting, setSorting)

  if (roster.isPending) {
    return (
      <section aria-label="Рейтинг силы">
        <LoadingState label="Загружаем рейтинг силы…" rows={3} />
      </section>
    )
  }
  if (roster.isError) {
    return (
      <section aria-label="Рейтинг силы">
        <ErrorState onRetry={() => void roster.refetch()} />
      </section>
    )
  }

  const classes = [
    ...new Map(
      roster.data.items.map((member) => [
        member.classId,
        { classId: member.classId, className: member.className },
      ]),
    ).values(),
  ].sort((a, b) => a.className.localeCompare(b.className, 'ru-RU'))
  const activeSort = sorting[0] ?? { id: 'pa', desc: true }
  const directionLabel = activeSort.desc
    ? 'По убыванию — сменить на возрастание'
    : 'По возрастанию — сменить на убывание'

  return (
    <section
      aria-label="Рейтинг силы"
      className="grid min-w-0 gap-3 rounded-2xl border border-border-accent bg-surface-inset/80 p-4"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="m-0 text-xl font-bold">Рейтинг силы</h2>
          <p className="m-0 text-sm text-muted-foreground">
            Участников: {members.length}
          </p>
        </div>
        <div className="grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)_44px] items-end gap-2 sm:w-auto">
          <div className="grid min-w-0 gap-1 text-xs text-muted-foreground">
            <label htmlFor="character-strength-class">Класс</label>
            <Select
              id="character-strength-class"
              aria-label="Класс"
              value={classId === null ? 'all' : String(classId)}
              onValueChange={(value) =>
                setClassId(value === 'all' ? null : Number(value))
              }
              options={[
                { value: 'all', label: 'Все классы' },
                ...classes.map((item) => ({
                  value: String(item.classId),
                  label: item.className,
                })),
              ]}
            />
          </div>
          <div className="grid min-w-0 gap-1 text-xs text-muted-foreground">
            <label htmlFor="character-strength-sort">Сортировать по</label>
            <Select
              id="character-strength-sort"
              aria-label="Сортировать по"
              value={activeSort.id}
              onValueChange={(value) => setSorting([{ id: value, desc: true }])}
              options={fields.map((field) => ({
                value: field,
                label: CHARACTER_STAT_LABELS[field],
              }))}
            />
          </div>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            aria-label={directionLabel}
            title={directionLabel}
            onClick={() =>
              setSorting([{ id: activeSort.id, desc: !activeSort.desc }])
            }
          >
            {activeSort.desc ? (
              <ArrowDown size={16} aria-hidden="true" />
            ) : (
              <ArrowUp size={16} aria-hidden="true" />
            )}
          </Button>
        </div>
      </div>
      {members.length === 0 ? (
        <EmptyState title="Участников не найдено" />
      ) : (
        <section
          aria-label="Прокручиваемый список рейтинга силы"
          className={scrollClass}
        >
          <table aria-label="Рейтинг силы" className={tableClass}>
            <thead>
              {ratingTable.getHeaderGroups().map((group) => (
                <tr key={group.id}>
                  <th scope="col" aria-label="Номер позиции">
                    №
                  </th>
                  {group.headers.map((header) => {
                    const sorted = header.column.getIsSorted()
                    const label = String(header.column.columnDef.header)
                    const sortable = fields.includes(
                      header.column.id as CharacterStatNumberField,
                    )
                    return (
                      <th
                        key={header.id}
                        scope="col"
                        aria-sort={
                          sorted === 'asc'
                            ? 'ascending'
                            : sorted === 'desc'
                              ? 'descending'
                              : 'none'
                        }
                      >
                        {sortable ? (
                          <button
                            type="button"
                            className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 font-semibold text-muted-foreground hover:text-primary"
                            onClick={header.column.getToggleSortingHandler()}
                          >
                            {label}
                            {sorted === 'asc' ? (
                              <ArrowUp size={12} aria-hidden="true" />
                            ) : sorted === 'desc' ? (
                              <ArrowDown size={12} aria-hidden="true" />
                            ) : (
                              <ArrowUpDown size={12} aria-hidden="true" />
                            )}
                          </button>
                        ) : (
                          label
                        )}
                      </th>
                    )
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {ratingTable.getRowModel().rows.map((row, rowIndex) => {
                const rank = String(rowIndex + 1).padStart(2, '0')
                return (
                  <tr
                    key={row.id}
                    className={`${rowIndex % 2 === 0 ? 'bg-surface-inset' : 'bg-surface-from'} hover:bg-surface-to`}
                  >
                    <td
                      aria-label={`Место ${rank}`}
                      className={`text-center text-xs ${rowIndex < 3 ? 'font-extrabold text-highlight' : 'font-semibold text-muted-foreground'}`}
                    >
                      {rank}
                    </td>
                    {row.getAllCells().map((cell, index) => {
                      const label = String(cell.column.columnDef.header)
                      return (
                        <td key={cell.id}>
                          <div className="flex min-w-0 items-baseline gap-1">
                            <MobileLabel text={label} first={index === 0} />
                            <ratingTable.FlexRender cell={cell} />
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      )}
    </section>
  )
}

function useRatingTable(
  data: RosterMember[],
  sorting: SortingState,
  onSortingChange: OnChangeFn<SortingState>,
) {
  return useTable({
    features: activityTableFeatures,
    columns,
    data,
    getRowId: (member) => member.id,
    state: { sorting },
    onSortingChange,
    enableSorting: true,
    enableSortingRemoval: false,
  })
}
