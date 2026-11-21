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
import { useMediaQuery } from '@/components/virtual-list'
import { useRoster } from '@/features/roster/api'
import { formatCharacterStat } from '@/features/roster/character-stats'
import { EmptyState } from '@/components/states/empty-state'
import { useSession } from '@/features/auth/session'

const fields = CHARACTER_STAT_FIELDS
const column = activityColumns<RosterMember>()
const columns: ActivityColumns<RosterMember> = [
  column.accessor('gameNickname', {
    header: 'Ник',
    cell: (info) => (
      <strong className="break-words max-[900px]:min-w-0 max-[900px]:truncate">
        {info.getValue()}
      </strong>
    ),
  }),
  column.accessor('className', {
    header: 'Класс',
    cell: (info) => {
      const member = info.row.original
      return (
        <span className="inline-flex min-w-0 items-center gap-1.5 max-[900px]:h-[26px] max-[900px]:flex-wrap max-[900px]:justify-end max-[900px]:overflow-hidden">
          <ClassIcon classId={member.classId} className={member.className} />
          <span className="whitespace-nowrap max-[900px]:leading-[26px]">
            {member.className}
          </span>
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

/**
 * На узком экране строка — карточка с переносом: в первой строке номер, ник
 * и класс справа; `::after` во всю ширину переносит пять показателей на
 * вторую строку, по пятой части каждый. Класс занимает остаток первой
 * строки: если название не помещается рядом с иконкой, оно уходит в
 * скрытую вторую строку ячейки — остаётся иконка; затем сокращается ник
 * (HOM-20).
 */
const tableClass =
  'w-full table-fixed border-collapse text-left text-sm [&_td]:border-b [&_td]:border-border [&_td]:px-2 [&_td]:py-2.5 [&_td]:align-middle [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:border-b [&_th]:border-border [&_th]:bg-surface-to [&_th]:px-2 [&_th]:py-2.5 [&_th]:font-semibold [&_th]:text-muted-foreground [&_th:first-child]:w-10 max-[900px]:block max-[900px]:[&_thead]:hidden max-[900px]:[&_tbody]:grid max-[900px]:[&_tbody]:gap-2.5 max-[900px]:[&_tr]:flex max-[900px]:[&_tr]:flex-wrap max-[900px]:[&_tr]:after:order-1 max-[900px]:[&_tr]:after:basis-full max-[900px]:[&_tr]:items-center max-[900px]:[&_tr]:gap-x-0 max-[900px]:[&_tr]:gap-y-1 max-[900px]:[&_tr]:rounded-xl max-[900px]:[&_tr]:border max-[900px]:[&_tr]:border-border max-[900px]:[&_tr]:p-3 max-[900px]:[&_td]:block max-[900px]:[&_td]:min-w-0 max-[900px]:[&_td]:border-0 max-[900px]:[&_td]:p-0 max-[900px]:[&_td:first-child]:flex-none max-[900px]:[&_td:nth-child(2)]:pl-3 max-[900px]:[&_td:nth-child(2)]:max-w-[calc(100%-5rem)] max-[900px]:[&_td:nth-child(2)]:truncate max-[900px]:[&_td:nth-child(2)]:text-base max-[900px]:[&_td:nth-child(3)]:min-w-[34px] max-[900px]:[&_td:nth-child(3)]:grow max-[900px]:[&_td:nth-child(3)]:basis-0 max-[900px]:[&_td:nth-child(3)]:pl-2 max-[900px]:[&_td:nth-child(3)>div]:items-center max-[900px]:[&_td:nth-child(3)>div]:justify-end max-[900px]:[&_td:nth-child(n+4)]:order-2 max-[900px]:[&_td:nth-child(n+4)]:basis-1/5 max-[900px]:[&_td:nth-child(n+4)]:mt-2 max-[900px]:[&_td:nth-child(n+4)]:border-t max-[900px]:[&_td:nth-child(n+4)]:px-0.5 max-[900px]:[&_td:nth-child(n+4)]:pt-2.5 max-[900px]:[&_td:nth-child(n+4)>div]:flex-col max-[900px]:[&_td:nth-child(n+4)>div]:items-center max-[900px]:[&_td:nth-child(n+4)>div]:gap-0.5 max-[900px]:[&_td:nth-child(n+4)>div]:font-semibold max-[900px]:[&_td:nth-child(n+4)>div]:whitespace-nowrap max-[900px]:[&_td:nth-child(n+4)>div]:tabular-nums'

/**
 * На компьютере — 15 строк с прокруткой внутри, но не выше окна, и без
 * `overscroll-contain`: у края списка прокрутка переходит к странице. На
 * узком экране своей прокрутки нет — иначе область выше экрана
 * перехватывает прокрутку страницы; карточки идут в потоке страницы.
 */
const scrollClass =
  'max-h-[min(900px,calc(100svh-6rem))] min-w-0 overflow-y-auto rounded-xl border border-border max-[900px]:max-h-none max-[900px]:overflow-visible max-[900px]:rounded-none max-[900px]:border-0'

/** Сколько карточек видно на узком экране до «Показать всех» (HOM-17). */
const NARROW_VISIBLE = 15

/** Подпись показателя в карточке; ник и класс понятны без подписи. */
function MobileLabel({ text }: { text: string }) {
  return (
    <span className="hidden text-xs font-normal text-muted-foreground max-[900px]:inline">
      {text}
    </span>
  )
}

/** Медали призовых мест на телефоне: золото, серебро, бронза (HOM-20). */
const medalText = [
  'bg-linear-135 from-medal-gold-from to-medal-gold-to',
  'bg-linear-135 from-medal-silver-from to-medal-silver-to',
  'bg-linear-135 from-medal-bronze-from to-medal-bronze-to',
]
const stripBase =
  'max-[900px]:relative max-[900px]:before:absolute max-[900px]:before:inset-y-3 max-[900px]:before:left-0 max-[900px]:before:w-1 max-[900px]:before:rounded-r-full max-[900px]:before:bg-linear-to-b'
const medalStrip = [
  `${stripBase} max-[900px]:before:from-medal-gold-from max-[900px]:before:to-medal-gold-to`,
  `${stripBase} max-[900px]:before:from-medal-silver-from max-[900px]:before:to-medal-silver-to`,
  `${stripBase} max-[900px]:before:from-medal-bronze-from max-[900px]:before:to-medal-bronze-to`,
]

/** Номер места в карточке на телефоне: «#1», у первых трёх — цвет медали. */
function MobileRank({ index }: { index: number }) {
  return (
    <span
      className={`hidden text-base font-extrabold tabular-nums max-[900px]:inline ${index < 3 ? `${medalText[index]} bg-clip-text text-transparent` : 'text-muted-foreground'}`}
    >
      #{index + 1}
    </span>
  )
}

/** Рейтинг силы использует общий roster/list кеш; дополнительных вызовов нет. */
export function CharacterStrengthRating() {
  const roster = useRoster()
  const currentUserId = useSession().session?.user.id
  const [classId, setClassId] = useState<number | null>(null)
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'pa', desc: true },
  ])
  const rosterItems = roster.data?.items ?? []
  const members = rosterItems.filter(
    (member) => classId === null || member.classId === classId,
  )
  const ratingTable = useRatingTable(members, sorting, setSorting)
  const narrow = useMediaQuery('(max-width: 900px)')
  const [expanded, setExpanded] = useState(false)

  if (roster.isPending) {
    return (
      <section aria-label="Рейтинг силы" className="mt-12">
        <LoadingState label="Загружаем рейтинг силы…" rows={3} />
      </section>
    )
  }
  if (roster.isError) {
    return (
      <section aria-label="Рейтинг силы" className="mt-12">
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
      className="mt-12 grid min-w-0 gap-3 rounded-2xl border border-border-accent bg-surface-inset/80 p-4"
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
              {ratingTable
                .getRowModel()
                .rows.slice(0, narrow && !expanded ? NARROW_VISIBLE : undefined)
                .map((row, rowIndex) => {
                  const rank = String(rowIndex + 1).padStart(2, '0')
                  return (
                    <tr
                      key={row.id}
                      className={`${rowIndex % 2 === 0 ? 'bg-surface-inset' : 'bg-surface-from'} hover:bg-surface-to ${row.original.id === currentUserId ? 'bg-item-highlight!' : ''} ${medalStrip[rowIndex] ?? ''}`}
                    >
                      <td
                        aria-label={`Место ${rank}`}
                        className={`text-center text-xs max-[900px]:text-left max-[900px]:text-sm ${rowIndex < 3 ? 'font-extrabold text-highlight' : 'font-semibold text-muted-foreground'}`}
                      >
                        <span className="max-[900px]:hidden">{rank}</span>
                        <MobileRank index={rowIndex} />
                      </td>
                      {row.getAllCells().map((cell, index) => {
                        const label = String(cell.column.columnDef.header)
                        return (
                          <td key={cell.id}>
                            <div className="flex min-w-0 items-baseline gap-1">
                              {index >= 2 ? <MobileLabel text={label} /> : null}
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
      {narrow && members.length > NARROW_VISIBLE ? (
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'Свернуть' : `Показать всех (${members.length})`}
        </Button>
      ) : null}
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
