import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/surfaces'
import { cn } from '@/lib/utils'

type ErrorStateProps = {
  title?: string
  message?: string
  onRetry?: () => void
  className?: string
}

/** Сообщение об ошибке без технических подробностей; детали — только в консоли. */
export function ErrorState({
  title = 'Что-то пошло не так',
  message = 'Не удалось загрузить данные. Попробуйте ещё раз чуть позже.',
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <Card
      role="alert"
      className={cn(
        'flex flex-col items-center gap-3 px-6 py-10 text-center',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="grid size-12 place-items-center rounded-full border border-destructive text-destructive"
      >
        <AlertTriangle size={22} />
      </span>
      <h2 className="text-xl font-bold">{title}</h2>
      <p className="max-w-md text-muted-foreground">{message}</p>
      {onRetry ? (
        <Button variant="secondary" className="mt-2" onClick={onRetry}>
          Повторить
        </Button>
      ) : null}
    </Card>
  )
}
