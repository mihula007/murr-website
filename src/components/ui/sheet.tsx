import type { ComponentProps } from 'react'
import * as SheetPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  dialogCloseClass,
  dialogDescriptionClass,
  overlayClass,
} from './dialog'

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
      <SheetPrimitive.Overlay className={overlayClass} />
      <SheetPrimitive.Content
        className={cn(
          'fixed inset-y-0 left-0 z-60 flex w-[min(88vw,360px)] flex-col gap-4 overflow-y-auto border-r border-border-strong bg-surface-header px-4 py-5 text-foreground shadow-sheet duration-220 ease-out data-[state=open]:animate-in data-[state=open]:slide-in-from-left motion-reduce:animate-none',
          className,
        )}
        {...props}
      >
        {children}
        <SheetPrimitive.Close
          className={dialogCloseClass}
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
      className={cn(
        'm-0 pr-11 font-sans text-[13px] font-black tracking-[0.13em]',
        className,
      )}
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
      className={cn(dialogDescriptionClass, className)}
      {...props}
    />
  )
}
