import type { ComponentProps } from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { cn } from '@/lib/utils'

export const Popover = PopoverPrimitive.Root
export const PopoverTrigger = PopoverPrimitive.Trigger
export const PopoverClose = PopoverPrimitive.Close

/**
 * Всплывающая панель у кнопки: Escape и клик вне закрывают, фокус
 * возвращается на кнопку. На узком экране занимает ширину окна с отступами.
 */
export function PopoverContent({
  className,
  align = 'end',
  sideOffset = 8,
  collisionPadding = 12,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          'z-40 flex w-[min(380px,calc(100vw-24px))] flex-col rounded-xl border border-border-strong bg-surface-menu text-foreground shadow-popover backdrop-blur-[14px] outline-none duration-140 ease-out data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}
