import { cn } from '@/lib/utils'

type NavBadgeProps = { count?: number | undefined; className?: string }

/** Счётчик новых записей в пункте меню; при 0 или без данных не рендерится. */
export function NavBadge({ count, className }: NavBadgeProps) {
  if (!count || count <= 0) {
    return null
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
