import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/** Общий вид текстовых полей: Input, Textarea, поле выбора файла. */
export const inputClass =
  'w-full min-w-0 rounded-lg border border-input bg-input-background px-3 py-2.5 text-base text-foreground placeholder:text-placeholder focus:border-ring aria-invalid:border-destructive'

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(inputClass, className)} {...props} />
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(inputClass, className)} {...props} />
}
