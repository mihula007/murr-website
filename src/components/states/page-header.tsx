import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type PageHeaderProps = {
  title: ReactNode
  description?: ReactNode
  eyebrow?: ReactNode
  actions?: ReactNode
  className?: string
}

/** Заголовок страницы по образцу `.page-title`/`.sub` прототипа. */
export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        'mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-4',
        className,
      )}
    >
      <div className="min-w-0 space-y-2">
        {eyebrow ? (
          <p className="text-xs font-extrabold tracking-[.2em] text-primary uppercase">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-[32px] leading-tight font-bold break-words max-sm:text-[26px]">
          {title}
        </h1>
        {description ? (
          <p className="max-w-2xl text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
    </header>
  )
}
