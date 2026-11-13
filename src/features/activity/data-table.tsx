import { useState, type ReactNode } from 'react'
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_basic,
  tableFeatures,
  useTable,
  type ColumnDef,
  type RowData,
  type SortingState,
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import {
  LoadMore,
  useMediaQuery,
  useWindowList,
  VirtualSpacerRow,
  type Paging,
} from '@/components/virtual-list'
import { cn } from '@/lib/utils'

/** Таблицы учёта: сортировка по столбцам (рейтинг, ACT-14). */
export const activityTableFeatures = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { basic: sortFn_basic },
})
export type ActivityTableFeatures = typeof activityTableFeatures

export function activityColumns<T extends RowData>() {
  return createColumnHelper<ActivityTableFeatures, T>()
}

// Столбцы таблиц разные по типу значения; общий тип — как у `column.columns`.
// oxlint-disable-next-line typescript/no-explicit-any
export type ActivityColumns<T extends RowData> = ColumnDef<
  ActivityTableFeatures,
  T,
  any
>[]

/** Сравнение ников и названий по-русски для сортировки столбца. */
export function sortByText<T>(read: (row: T) => string) {
  return (a: { original: T }, b: { original: T }) =>
    read(a.original).localeCompare(read(b.original), 'ru-RU')
}

/**
 * Таблица: на узком экране строка — карточка в три колонки (короче лента
 * на телефоне), подпись столбца — видимый текст в ячейке; ячейка с `data-title` — заголовок карточки. Без горизонтальной
 * прокрутки на 375 px.
 */
const tableClass =
  'w-full border-collapse text-left text-[13px] max-[900px]:block [&_td]:border-b [&_td]:border-border [&_td]:px-2 [&_td]:py-2.5 [&_td]:align-middle [&_th]:border-b [&_th]:border-border [&_th]:px-2 [&_th]:py-2.5 [&_th]:font-semibold [&_th]:text-muted-foreground max-[900px]:[&_tbody]:grid max-[900px]:[&_tbody]:gap-2.5 max-[900px]:[&_thead]:hidden max-[900px]:text-sm max-[900px]:[&_tr]:grid max-[900px]:[&_tr]:grid-cols-3 max-[900px]:[&_tr]:gap-x-3 max-[900px]:[&_tr]:gap-y-2 max-[900px]:[&_tr]:rounded-xl max-[900px]:[&_tr]:border max-[900px]:[&_tr]:border-border max-[900px]:[&_tr]:bg-surface-inset max-[900px]:[&_tr]:p-3 max-[900px]:[&_td]:grid max-[900px]:[&_td]:gap-0.5 max-[900px]:[&_td]:border-0 max-[900px]:[&_td]:p-0 max-[900px]:[&_td[data-title]]:col-span-full max-[900px]:[&_td[data-title]]:flex max-[900px]:[&_td[data-title]]:items-baseline max-[900px]:[&_td[data-title]]:gap-1 max-[900px]:[&_td[data-title]]:text-base'

/** Подпись столбца в карточке узкого экрана; у первой ячейки не нужна. */
function MobileLabel({ text, first }: { text: string; first: boolean }) {
  return (
    <span
      className={cn(
        'hidden text-xs text-muted-foreground max-[900px]:block',
        first && 'max-[900px]:hidden',
      )}
    >
      {text}
    </span>
  )
}

type DataTableProps<T extends RowData> = {
  label: string
  columns: ActivityColumns<T>
  data: T[]
  getRowId: (row: T) => string
  /** Сортировка по клику на заголовок; без неё — порядок сервера. */
  sortable?: boolean
  /** Столбец «№» по текущему порядку строк. */
  numbered?: boolean
  empty: ReactNode
}

/** Таблица всего списка: малые списки и участники клана целиком (Q-48). */
export function DataTable<T extends RowData>({
  label,
  columns,
  data,
  getRowId,
  sortable = false,
  numbered = false,
  empty,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([])
  const table = useTable({
    features: activityTableFeatures,
    columns,
    data,
    getRowId,
    enableSorting: sortable,
    state: { sorting },
    onSortingChange: setSorting,
  })
  const rows = table.getRowModel().rows
  if (data.length === 0) {
    return <>{empty}</>
  }
  return (
    <table aria-label={label} className={tableClass}>
      <thead>
        {table.getHeaderGroups().map((group) => (
          <tr key={group.id}>
            {numbered ? <th scope="col">№</th> : null}
            {group.headers.map((header) => {
              const sorted = header.column.getIsSorted()
              const title = String(header.column.columnDef.header)
              return (
                <th
                  key={header.id}
                  scope="col"
                  aria-sort={
                    sorted === 'asc'
                      ? 'ascending'
                      : sorted === 'desc'
                        ? 'descending'
                        : undefined
                  }
                >
                  {header.column.getCanSort() ? (
                    <button
                      type="button"
                      className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 font-semibold text-muted-foreground hover:text-primary"
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      {title}
                      {sorted === 'asc' ? (
                        <ArrowUp size={12} aria-hidden="true" />
                      ) : sorted === 'desc' ? (
                        <ArrowDown size={12} aria-hidden="true" />
                      ) : (
                        <ArrowUpDown size={12} aria-hidden="true" />
                      )}
                    </button>
                  ) : (
                    title
                  )}
                </th>
              )
            })}
          </tr>
        ))}
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={row.id}>
            {numbered ? (
              <td className="text-primary tabular-nums max-[900px]:hidden!">
                {index + 1}
              </td>
            ) : null}
            {row.getAllCells().map((cell, cellIndex) => (
              <td key={cell.id} data-title={cellIndex === 0 ? '' : undefined}>
                <MobileLabel
                  text={String(cell.column.columnDef.header)}
                  first={cellIndex === 0}
                />
                {numbered && cellIndex === 0 ? (
                  <span className="hidden text-primary max-[900px]:inline">
                    {index + 1}.{' '}
                  </span>
                ) : null}
                <table.FlexRender cell={cell} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Промежуток между карточками строк на узком экране (`gap-2.5`), px. */
const NARROW_GAP = 10

/** Таблица большого списка: страницы по курсору, строки виртуализированы. */
export function VirtualDataTable<T extends RowData>({
  label,
  columns,
  data,
  getRowId,
  paging,
  empty,
}: Omit<DataTableProps<T>, 'sortable' | 'numbered'> & { paging: Paging }) {
  const table = useTable({
    features: activityTableFeatures,
    columns,
    data,
    getRowId,
    enableSorting: false,
  })
  const rows = table.getRowModel().rows
  const narrow = useMediaQuery('(max-width: 900px)')
  const {
    setListElement,
    items: virtualItems,
    measureElement,
    before,
    after,
  } = useWindowList({
    count: rows.length,
    estimateSize: narrow ? 150 : 44,
    gap: narrow ? NARROW_GAP : 0,
    getItemKey: (index) => rows[index]?.id ?? String(index),
    paging,
  })
  const spacer = (height: number) => (narrow ? height - NARROW_GAP : height)
  if (data.length === 0) {
    return <>{empty}</>
  }
  return (
    <>
      <table aria-label={label} className={tableClass}>
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => (
                <th key={header.id} scope="col">
                  {String(header.column.columnDef.header)}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody ref={setListElement}>
          <VirtualSpacerRow height={spacer(before)} colSpan={columns.length} />
          {virtualItems.map((item) => {
            const row = rows[item.index]
            if (!row) {
              return null
            }
            return (
              <tr key={row.id} data-index={item.index} ref={measureElement}>
                {row.getAllCells().map((cell, cellIndex) => (
                  <td
                    key={cell.id}
                    data-title={cellIndex === 0 ? '' : undefined}
                  >
                    <MobileLabel
                      text={String(cell.column.columnDef.header)}
                      first={cellIndex === 0}
                    />
                    <table.FlexRender cell={cell} />
                  </td>
                ))}
              </tr>
            )
          })}
          <VirtualSpacerRow height={spacer(after)} colSpan={columns.length} />
        </tbody>
      </table>
      <LoadMore paging={paging} />
    </>
  )
}
