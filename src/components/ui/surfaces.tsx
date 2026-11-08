import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('guild-card', className)} {...props} />
}

export function Badge({ className, ...props }: ComponentProps<'span'>) {
  return <span className={cn('guild-badge', className)} {...props} />
}

export function Notice({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('guild-notice', className)} {...props} />
}

export function Field({
  className,
  htmlFor,
  ...props
}: ComponentProps<'label'> & { htmlFor: string }) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn('guild-field', className)}
      {...props}
    />
  )
}
