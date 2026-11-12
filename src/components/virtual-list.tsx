import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { useVirtualizer, useWindowVirtualizer } from '@tanstack/react-virtual'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Большие списки (AGENTS.md, «Списки»): страницы по курсору из
 * `useInfiniteQuery` и отрисовка только видимых строк TanStack Virtual.
 * Страница прокручивается окном, поэтому используется window-виртуализатор.
 *
 * Геометрию виртуализатора (отступы до и после видимых строк) нельзя
 * выразить статическими утилитами: она передаётся CSS-переменными через
 * `style` — единственное разрешённое исключение правила стилей (только этот
 * файл и только переменные `--virtual-*`, см. `scripts/style-rules.ts`).
 */

/** Состояние догрузки из `useInfiniteQuery`. */
export type Paging = {
  hasMore: boolean
  loadingMore: boolean
  loadError: boolean
  onLoadMore: () => void
}

type InfiniteState = {
  hasNextPage: boolean
  isFetchingNextPage: boolean
  isFetchNextPageError: boolean
  fetchNextPage: () => Promise<unknown>
}

export function pagingOf(query: InfiniteState): Paging {
  return {
    hasMore: query.hasNextPage,
    loadingMore: query.isFetchingNextPage,
    loadError: query.isFetchNextPageError,
    onLoadMore: () => void query.fetchNextPage(),
  }
}

function matches(query: string) {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia(query).matches
    : false
}

/** Совпадение медиазапроса; без `matchMedia` (jsdom) — `false`. */
export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== 'function') {
        return () => undefined
      }
      const media = window.matchMedia(query)
      media.addEventListener('change', onChange)
      return () => media.removeEventListener('change', onChange)
    },
    () => matches(query),
  )
}

/**
 * Число колонок сетки карточек по брейкпоинтам Tailwind sm (40rem) и lg
 * (64rem). Классы строки (`grid-cols-*`, `sm:…`, `lg:…`) задают те же числа.
 */
export function useGridColumns(columns: {
  base: number
  sm: number
  lg: number
}) {
  const sm = useMediaQuery('(min-width: 40rem)')
  const lg = useMediaQuery('(min-width: 64rem)')
  if (lg) {
    return columns.lg
  }
  return sm ? columns.sm : columns.base
}

/**
 * Виртуализатор по окну для списка из `count` строк: отступ списка от
 * начала документа пересчитывается при каждой отрисовке и изменении
 * размеров страницы (над списком могут догрузиться фильтры и статистика).
 */
export function useWindowList({
  count,
  estimateSize,
  gap,
  getItemKey,
  paging,
}: {
  count: number
  estimateSize: number
  gap: number
  getItemKey: (index: number) => string
  paging: Paging
}) {
  const [element, setListElement] = useState<HTMLElement | null>(null)
  const [scrollMargin, setScrollMargin] = useState(0)

  useLayoutEffect(() => {
    if (!element) {
      return undefined
    }
    const measure = () => {
      const margin = element.getBoundingClientRect().top + window.scrollY
      setScrollMargin((previous) =>
        Math.abs(previous - margin) < 1 ? previous : margin,
      )
    }
    measure()
    if (typeof ResizeObserver === 'undefined') {
      return undefined
    }
    const observer = new ResizeObserver(measure)
    observer.observe(document.body)
    return () => observer.disconnect()
  }, [element])

  // Проект не использует React Compiler; функции виртуализатора меняются
  // при каждой отрисовке, и это ожидаемо (правило о мемоизации компилятором).
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useWindowVirtualizer({
    count,
    estimateSize: () => estimateSize,
    gap,
    overscan: 4,
    scrollMargin,
    getItemKey,
  })
  const items = virtualizer.getVirtualItems()
  const first = items[0]
  const last = items.at(-1)
  const before = first ? first.start - scrollMargin : 0
  const after = last
    ? Math.max(0, virtualizer.getTotalSize() - (last.end - scrollMargin))
    : 0

  // Дошли до последней загруженной строки — запрашиваем следующую страницу.
  const { hasMore, loadingMore, loadError, onLoadMore } = paging
  const reachedEnd = last !== undefined && last.index >= count - 1
  useEffect(() => {
    if (reachedEnd && hasMore && !loadingMore && !loadError) {
      onLoadMore()
    }
  }, [reachedEnd, hasMore, loadingMore, loadError, onLoadMore])

  return {
    setListElement,
    items,
    measureElement: virtualizer.measureElement,
    before,
    after,
  }
}

/** Расстояние до низа, при котором блок считается прокрученным до конца, px. */
const BOTTOM_THRESHOLD = 48

/**
 * Виртуализатор внутри прокручиваемого блока для ленты, растущей вверх
 * (ветка обсуждения): строки идут от старых к новым, при открытии блок
 * прокручен вниз, старые страницы догружаются при прокрутке к началу без
 * сдвига видимого текста, новые строки в конце прокручивают блок вниз,
 * только если он уже был внизу.
 */
export function useElementList({
  count,
  estimateSize,
  gap,
  getItemKey,
  paging,
}: {
  count: number
  estimateSize: number
  gap: number
  getItemKey: (index: number) => string
  paging: Paging
}) {
  const [element, setScrollElement] = useState<HTMLElement | null>(null)
  const [atBottom, setAtBottom] = useState(true)

  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => element,
    estimateSize: () => estimateSize,
    gap,
    overscan: 6,
    getItemKey,
    // Размер до первого измерения (и в jsdom, где размеров нет).
    initialRect: { width: 360, height: 480 },
  })
  const items = virtualizer.getVirtualItems()
  const total = virtualizer.getTotalSize()
  const first = items[0]
  const last = items.at(-1)
  const before = first ? first.start : 0
  const after = last ? Math.max(0, total - last.end) : 0

  const firstKey = count > 0 ? getItemKey(0) : null
  const lastKey = count > 0 ? getItemKey(count - 1) : null
  const anchor = useRef({
    firstKey: null as string | null,
    lastKey: null as string | null,
    total: 0,
    atBottom: true,
  })

  const scrollToEnd = useCallback(() => {
    if (element) {
      element.scrollTop = element.scrollHeight
    }
  }, [element])

  useLayoutEffect(() => {
    if (!element) {
      return
    }
    const previous = anchor.current
    if (previous.lastKey === null && lastKey !== null) {
      scrollToEnd()
    } else if (previous.firstKey !== firstKey && previous.lastKey === lastKey) {
      // Сверху добавились старые строки — сохраняем видимое место.
      element.scrollTop += total - previous.total
    } else if (
      previous.atBottom &&
      (previous.lastKey !== lastKey || previous.total !== total)
    ) {
      // Новые строки или измеренная высота — остаёмся внизу.
      scrollToEnd()
    }
    anchor.current = { ...previous, firstKey, lastKey, total }
  }, [element, firstKey, lastKey, total, scrollToEnd])

  useEffect(() => {
    if (!element) {
      return undefined
    }
    const onScroll = () => {
      const bottom =
        element.scrollHeight - element.scrollTop - element.clientHeight <
        BOTTOM_THRESHOLD
      anchor.current.atBottom = bottom
      setAtBottom(bottom)
    }
    element.addEventListener('scroll', onScroll, { passive: true })
    return () => element.removeEventListener('scroll', onScroll)
  }, [element])

  // Дошли до самой старой загруженной строки — запрашиваем более старые.
  const { hasMore, loadingMore, loadError, onLoadMore } = paging
  const reachedStart = first !== undefined && first.index === 0
  useEffect(() => {
    if (reachedStart && hasMore && !loadingMore && !loadError) {
      onLoadMore()
    }
  }, [reachedStart, hasMore, loadingMore, loadError, onLoadMore])

  return {
    setScrollElement,
    items,
    measureElement: virtualizer.measureElement,
    before,
    after,
    atBottom,
    scrollToEnd,
  }
}

/** Догрузка: идёт, ошибка с повтором или кнопка на случай без прокрутки. */
export function LoadMore({ paging }: { paging: Paging }) {
  if (paging.loadError) {
    return (
      <div
        role="alert"
        className="mt-3 flex flex-wrap items-center justify-center gap-3 text-sm text-muted-foreground"
      >
        Не удалось загрузить продолжение списка.
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={paging.onLoadMore}
        >
          Повторить
        </Button>
      </div>
    )
  }
  if (paging.loadingMore) {
    return (
      <output
        aria-live="polite"
        className="mt-3 block text-center text-sm text-muted-foreground"
      >
        Загружаем ещё…
      </output>
    )
  }
  if (!paging.hasMore) {
    return null
  }
  return (
    <div className="mt-3 flex justify-center">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={paging.onLoadMore}
      >
        Показать ещё
      </Button>
    </div>
  )
}

const GAP = { sm: 8, md: 12 } as const
const gapClass = { sm: 'gap-2', md: 'gap-3' } as const

type VirtualListProps<T> = {
  items: readonly T[]
  getKey: (item: T) => string
  renderItem: (item: T) => ReactNode
  /** Доступное имя списка. */
  label: string
  /** Ожидаемая высота строки, px; реальная измеряется. */
  estimateSize: number
  paging: Paging
  /** Карточек в строке; те же числа задают классы `gridClassName`. */
  columns?: number
  gridClassName?: string
  gap?: keyof typeof GAP
}

/** Виртуализированный список или сетка карточек с догрузкой страниц. */
export function VirtualList<T>({
  items,
  getKey,
  renderItem,
  label,
  estimateSize,
  paging,
  columns = 1,
  gridClassName,
  gap = 'sm',
}: VirtualListProps<T>) {
  const rowCount = Math.ceil(items.length / columns)
  const {
    setListElement,
    items: virtualItems,
    measureElement,
    before,
    after,
  } = useWindowList({
    count: rowCount,
    estimateSize,
    gap: GAP[gap],
    getItemKey: (index) => {
      const item = items[index * columns]
      return item ? getKey(item) : String(index)
    },
    paging,
  })

  // Список — CSS-сетка без обёрток строк: элементы видимых строк идут
  // подряд, высоту строки виртуализатор измеряет по её первому элементу
  // (элементы строки растягиваются до общей высоты).
  const visible = virtualItems.flatMap((row) =>
    items
      .slice(row.index * columns, (row.index + 1) * columns)
      .map((item, position) => ({ item, row, first: position === 0 })),
  )
  return (
    <div>
      <ul
        ref={setListElement}
        aria-label={label}
        style={
          {
            '--virtual-before': `${before}px`,
            '--virtual-after': `${after}px`,
          } as CSSProperties
        }
        className={cn(
          'm-0 grid list-none px-0 pt-(--virtual-before) pb-(--virtual-after)',
          gapClass[gap],
          gridClassName,
        )}
      >
        {visible.map(({ item, row, first }) => (
          <li
            key={getKey(item)}
            data-index={first ? row.index : undefined}
            ref={first ? measureElement : undefined}
            className="min-w-0"
          >
            {renderItem(item)}
          </li>
        ))}
      </ul>
      <LoadMore paging={paging} />
    </div>
  )
}

/** Отступ таблицы до или после видимых строк (`<tr>` внутри `<tbody>`). */
export function VirtualSpacerRow({
  height,
  colSpan,
}: {
  height: number
  colSpan: number
}) {
  if (height <= 0) {
    return null
  }
  return (
    <tr
      aria-hidden="true"
      style={{ '--virtual-space': `${height}px` } as CSSProperties}
      className="h-(--virtual-space) max-[900px]:block! max-[900px]:border-0! max-[900px]:bg-transparent! max-[900px]:p-0!"
    >
      <td
        aria-hidden="true"
        colSpan={colSpan}
        className="h-(--virtual-space) border-0! p-0! max-[900px]:hidden"
      />
    </tr>
  )
}

type ReverseVirtualListProps<T> = {
  /** От старых к новым. */
  items: readonly T[]
  getKey: (item: T) => string
  renderItem: (item: T) => ReactNode
  label: string
  estimateSize: number
  paging: Paging
  /** Классы прокручиваемого блока: высота задаётся снаружи. */
  className?: string | undefined
  /** Блок дошёл до низа или ушёл от него (отметка прочтения). */
  onAtBottomChange?: ((atBottom: boolean) => void) | undefined
  /** Смена значения прокручивает к последней строке (своё сообщение). */
  scrollToEndKey?: unknown
}

/**
 * Лента в прокручиваемом блоке, растущая вверх (`useElementList`):
 * догрузка старых строк сверху, новые — снизу.
 */
export function ReverseVirtualList<T>({
  items,
  getKey,
  renderItem,
  label,
  estimateSize,
  paging,
  className,
  onAtBottomChange,
  scrollToEndKey,
}: ReverseVirtualListProps<T>) {
  const {
    setScrollElement,
    items: virtualItems,
    measureElement,
    before,
    after,
    atBottom,
    scrollToEnd,
  } = useElementList({
    count: items.length,
    estimateSize,
    gap: GAP.sm,
    getItemKey: (index) => {
      const item = items[index]
      return item ? getKey(item) : String(index)
    },
    paging,
  })

  useEffect(() => {
    onAtBottomChange?.(atBottom)
  }, [atBottom, onAtBottomChange])

  useLayoutEffect(() => {
    if (scrollToEndKey !== undefined) {
      scrollToEnd()
    }
  }, [scrollToEndKey, scrollToEnd])

  return (
    <div
      ref={setScrollElement}
      className={cn('overflow-y-auto overscroll-contain', className)}
    >
      <LoadMore paging={paging} />
      <ul
        aria-label={label}
        style={
          {
            '--virtual-before': `${before}px`,
            '--virtual-after': `${after}px`,
          } as CSSProperties
        }
        className="m-0 grid list-none gap-2 px-0 pt-(--virtual-before) pb-(--virtual-after)"
      >
        {virtualItems.map((row) => {
          const item = items[row.index]
          return item === undefined ? null : (
            <li
              key={getKey(item)}
              data-index={row.index}
              ref={measureElement}
              className="min-w-0"
            >
              {renderItem(item)}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
