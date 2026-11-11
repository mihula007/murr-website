import type { ReactNode } from 'react'
import { fieldClass } from '@/components/ui/surfaces'
import { fieldMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

/** Сетка формы: две колонки, одна на узком экране; `col-span-full` — во всю ширину. */
export const formGridClass =
  'grid grid-cols-2 gap-x-[13px] gap-y-3.5 max-[650px]:grid-cols-1'
export const formLabelClass = 'text-sm font-semibold text-foreground'
export const fieldHintClass = 'text-xs text-muted-foreground'
export const fieldErrorClass = 'text-xs text-destructive'

/** Вложенная форма (например, в кабинете). */
export const subformClass =
  'grid gap-4 rounded-xl border border-border bg-surface-inset p-4'

/** Заголовок блока формы: золотой, капителью, во всю ширину сетки. */
export function FormSectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="col-span-full mt-2 mb-0 text-xs font-extrabold tracking-[0.16em] text-primary uppercase">
      {children}
    </h2>
  )
}

/** Атрибуты доступности для поля с ошибкой и подсказкой. */
export function fieldAria(
  id: string,
  error?: string | null | undefined,
  hint?: ReactNode,
) {
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-error` : '']
    .filter(Boolean)
    .join(' ')
  return {
    id,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy || undefined,
  } as const
}

type FieldMeta = {
  errors: unknown[]
  isTouched: boolean
  isBlurred?: boolean
}

/**
 * Текст первой ошибки поля TanStack Form. Ошибки показываются после ухода с
 * поля или после попытки отправки; серверная ошибка поля имеет приоритет.
 */
export function fieldError(
  meta: FieldMeta,
  submitted: boolean,
  serverCode?: string,
) {
  if (serverCode) {
    return fieldMessage(serverCode)
  }
  if (!submitted && !(meta.isTouched && meta.isBlurred)) {
    return null
  }
  const first = meta.errors.find(Boolean)
  if (!first) {
    return null
  }
  const code =
    typeof first === 'string'
      ? first
      : String((first as { message?: string }).message ?? '')
  return fieldMessage(code)
}

type FormFieldProps = {
  id: string
  label: ReactNode
  error?: string | null | undefined
  hint?: ReactNode
  className?: string
  children: ReactNode
}

export function FormField({
  id,
  label,
  error,
  hint,
  className,
  children,
}: FormFieldProps) {
  return (
    <div className={cn(fieldClass, className)}>
      <label htmlFor={id} className={formLabelClass}>
        {label}
      </label>
      {children}
      {hint ? (
        <small id={`${id}-hint`} className={fieldHintClass}>
          {hint}
        </small>
      ) : null}
      {error ? (
        <small id={`${id}-error`} className={fieldErrorClass}>
          {error}
        </small>
      ) : null}
    </div>
  )
}
