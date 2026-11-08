import type { ReactNode } from 'react'
import { Inbox } from 'lucide-react'
import { Card } from '@/components/ui/surfaces'
import { cn } from '@/lib/utils'

type EmptyStateProps = {
  title: ReactNode
  description?: ReactNode
  icon?: ReactNode
  action?: ReactNode
  className?: string
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
}: EmptyStateProps) {
  return (
    <Card
      className={cn(
        'flex flex-col items-center gap-3 px-6 py-10 text-center',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="grid size-12 place-items-center rounded-full border border-border-accent text-primary"
      >
        {icon ?? <Inbox size={22} />}
      </span>
      <h2 className="text-xl font-bold">{title}</h2>
      {description ? (
        <p className="max-w-md text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </Card>
  )
}
