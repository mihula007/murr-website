import type { ComponentProps } from 'react'
import * as ContextMenuPrimitive from '@radix-ui/react-context-menu'
import { cn } from '@/lib/utils'

/**
 * Контекстное меню по правому клику (и долгому нажатию на сенсорном
 * экране — поведение Radix). Вид совпадает с `DropdownMenu`: у каждого
 * действия такого меню должна быть видимая альтернатива (Q-61).
 */
export const ContextMenu = ContextMenuPrimitive.Root
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger

export function ContextMenuContent({
  className,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Content>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        className={cn(
          'z-40 flex max-w-[min(320px,calc(100vw-28px))] min-w-[220px] flex-col gap-[3px] rounded-xl border border-border-strong bg-surface-menu p-[7px] text-foreground shadow-popover backdrop-blur-[14px] duration-140 ease-out data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none',
          className,
        )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  )
}

export function ContextMenuItem({
  className,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Item>) {
  return (
    <ContextMenuPrimitive.Item
      className={cn(
        'relative flex cursor-pointer items-center justify-between gap-3 rounded-md px-3 py-2.5 text-base text-foreground outline-none select-none data-disabled:cursor-default data-disabled:opacity-50 data-highlighted:bg-secondary data-highlighted:text-highlight data-highlighted:inset-ring data-highlighted:inset-ring-border-accent',
        className,
      )}
      {...props}
    />
  )
}

export function ContextMenuLabel({
  className,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Label>) {
  return (
    <ContextMenuPrimitive.Label
      className={cn(
        'px-3 pt-1.5 pb-0.5 text-xs font-semibold text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

export function ContextMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return (
    <ContextMenuPrimitive.Separator
      className={cn('my-1 h-px bg-border', className)}
      {...props}
    />
  )
}
