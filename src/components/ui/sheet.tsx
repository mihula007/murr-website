import type { ComponentProps } from 'react'
import * as SheetPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export const Sheet = SheetPrimitive.Root
export const SheetTrigger = SheetPrimitive.Trigger
export const SheetClose = SheetPrimitive.Close

/** Боковая панель слева на базе Dialog: фокус-ловушка, Escape, блокировка прокрутки фона. */
export function SheetContent({
  className,
  children,
  closeLabel = 'Закрыть',
  ...props
}: ComponentProps<typeof SheetPrimitive.Content> & { closeLabel?: string }) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay className="guild-overlay" />
      <SheetPrimitive.Content
        className={cn('guild-sheet', className)}
        {...props}
      >
        {children}
        <SheetPrimitive.Close
          className="guild-dialog-close"
          aria-label={closeLabel}
        >
          <X aria-hidden="true" size={18} />
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  )
}

export function SheetTitle({
  className,
  ...props
}: ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      className={cn('guild-sheet-title', className)}
      {...props}
    />
  )
}

export function SheetDescription({
  className,
  ...props
}: ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      className={cn('guild-dialog-description', className)}
      {...props}
    />
  )
}
