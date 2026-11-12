import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { buttonVariants } from './button'

/**
 * Номера для навигации: первая, последняя, текущая и соседние страницы;
 * пропуски — `'gap'`. Не больше семи элементов при любом числе страниц.
 */
export function pageItems(page: number, pageCount: number) {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, index) => index + 1)
  }
  const from = Math.max(2, Math.min(page - 1, pageCount - 4))
  const to = Math.min(pageCount - 1, Math.max(page + 1, 5))
  const items: (number | 'gap')[] = [1]
  if (from > 2) {
    items.push('gap')
  }
  for (let value = from; value <= to; value += 1) {
    items.push(value)
  }
  if (to < pageCount - 1) {
    items.push('gap')
  }
  items.push(pageCount)
  return items
}

const itemClass = cn(
  buttonVariants({ variant: 'ghost', size: 'sm' }),
  'min-w-9 tabular-nums',
)

type PaginationProps = {
  page: number
  pageCount: number
  onPageChange: (page: number) => void
  className?: string
}

/**
 * Нумерованная навигация по страницам ленты (Q-55). На узком экране —
 * компактный вид «‹ 3 из 12 ›» без горизонтальной прокрутки.
 */
export function Pagination({
  page,
  pageCount,
  onPageChange,
  className,
}: PaginationProps) {
  if (pageCount <= 1) {
    return null
  }
  const go = (value: number) => () => onPageChange(value)
  return (
    <nav
      aria-label="Страницы"
      className={cn('flex items-center justify-center gap-1', className)}
    >
      <button
        type="button"
        className={itemClass}
        disabled={page <= 1}
        onClick={go(page - 1)}
        aria-label="Предыдущая страница"
      >
        <ChevronLeft aria-hidden className="size-4" />
      </button>
      <span className="px-2 text-sm text-muted-foreground tabular-nums sm:hidden">
        {page} из {pageCount}
      </span>
      <ul className="hidden items-center gap-1 sm:flex">
        {pageItems(page, pageCount).map((item, index) =>
          item === 'gap' ? (
            <li
              key={`gap-${index}`}
              aria-hidden
              className="px-1 text-muted-foreground"
            >
              …
            </li>
          ) : (
            <li key={item}>
              <button
                type="button"
                className={cn(
                  itemClass,
                  item === page && 'border-primary text-primary',
                )}
                aria-current={item === page ? 'page' : undefined}
                aria-label={`Страница ${item}`}
                onClick={go(item)}
              >
                {item}
              </button>
            </li>
          ),
        )}
      </ul>
      <button
        type="button"
        className={itemClass}
        disabled={page >= pageCount}
        onClick={go(page + 1)}
        aria-label="Следующая страница"
      >
        <ChevronRight aria-hidden className="size-4" />
      </button>
    </nav>
  )
}
