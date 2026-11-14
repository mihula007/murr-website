import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-border bg-linear-145/srgb from-surface-from to-surface-to p-5',
        className,
      )}
      {...props}
    />
  )
}

/**
 * Служебный блок (настройки раздела, итоги, подсказки): вдавленная
 * поверхность без градиента и тени — ниже карточки объекта по уровню.
 */
export function Panel({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border/70 bg-surface-inset p-4',
        className,
      )}
      {...props}
    />
  )
}

/** Строка участника или записи в сетке: без рамки, легче карточки. */
export const tileClass = 'rounded-xl bg-surface-inset/70 p-4'

export function Badge({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-border-accent px-2 py-1 text-2xs text-tag-foreground',
        className,
      )}
      {...props}
    />
  )
}

/**
 * Метка состояния «сейчас» (идёт, онлайн): зелёная, с пульсирующей точкой.
 * Пульсация отключается при `prefers-reduced-motion`.
 */
export function LiveBadge({
  className,
  children,
  ...props
}: ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-live-border bg-live-surface px-2 py-1 text-2xs font-semibold text-live',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className="size-1.5 rounded-full bg-live animate-live-pulse motion-reduce:animate-none"
      />
      {children}
    </span>
  )
}

export function Notice({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'rounded-xl border border-dashed border-notice-border bg-secondary px-4 py-3 text-notice-foreground',
        className,
      )}
      {...props}
    />
  )
}

/** Подпись с полем внутри: вертикальный стек, приглушённый мелкий текст. */
export const fieldClass = 'flex flex-col gap-2 text-xs text-muted-foreground'

export function Field({
  className,
  htmlFor,
  ...props
}: ComponentProps<'label'> & { htmlFor: string }) {
  return (
    <label htmlFor={htmlFor} className={cn(fieldClass, className)} {...props} />
  )
}

export function Table({ className, ...props }: ComponentProps<'table'>) {
  return (
    <table
      className={cn(
        'w-full border-collapse text-left text-[13px] [&_:is(td,th)]:border-b [&_:is(td,th)]:border-border [&_:is(td,th)]:px-2 [&_:is(td,th)]:py-3 [&_th]:font-semibold [&_th]:text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}
