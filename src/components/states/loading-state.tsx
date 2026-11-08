import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

type LoadingStateProps = {
  label?: string
  rows?: number
  className?: string
}

export function LoadingState({
  label = 'Загрузка…',
  rows = 3,
  className,
}: LoadingStateProps) {
  return (
    <output
      aria-busy="true"
      aria-live="polite"
      className={cn('grid gap-3', className)}
    >
      <span className="sr-only">{label}</span>
      <Skeleton className="h-7 w-2/3 max-w-80" />
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-20" />
      ))}
    </output>
  )
}
