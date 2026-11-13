import { cn } from '@/lib/utils'

type NavBadgeProps = {
  count?: number | undefined
  /**
   * Точка вместо числа — для категории меню и кнопки мобильного меню: сумма
   * по разделам почти всегда велика и перестаёт что-то значить, число
   * остаётся у самого раздела.
   */
  dot?: boolean
  className?: string
}

/** Счётчик новых записей в пункте меню; при 0 или без данных не рендерится. */
export function NavBadge({ count, dot = false, className }: NavBadgeProps) {
  if (!count || count <= 0) {
    return null
  }
  if (dot) {
    return (
      <span
        className={cn(
          'inline-block size-2 flex-none rounded-full bg-badge',
          className,
        )}
      >
        <span className="sr-only">есть новое</span>
      </span>
    )
  }
  return (
    <span
      className={cn(
        'inline-grid h-[17px] min-w-[17px] flex-none place-items-center rounded-full bg-badge px-1 text-[10px] leading-none font-extrabold text-badge-foreground',
        className,
      )}
      aria-label={`${count} новых записей`}
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}
