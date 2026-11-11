import type { ComponentProps } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Общие классы модальных окон: Dialog, AlertDialog и Sheet. */
export const overlayClass =
  'fixed inset-0 z-60 bg-overlay backdrop-blur-[2px] duration-180 ease-out data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none'
export const dialogContentClass =
  'fixed top-1/2 left-1/2 z-61 grid max-h-[calc(100svh-28px)] w-[min(calc(100vw-28px),460px)] -translate-1/2 gap-4 overflow-y-auto rounded-2xl border border-border-strong bg-linear-145/srgb from-surface-from to-surface-to p-6 text-foreground shadow-dialog duration-180 ease-out data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-97 data-[state=open]:slide-in-from-bottom-[2%] max-xs:p-5 motion-reduce:animate-none'
export const dialogTitleClass = 'm-0 text-xl leading-tight font-bold'
export const dialogDescriptionClass = 'm-0 text-muted-foreground'
export const dialogFooterClass =
  'flex flex-wrap justify-end gap-3 max-xs:*:flex-auto'
export const dialogCloseClass =
  'absolute top-3 right-3 grid size-9 cursor-pointer place-items-center rounded-lg border-0 bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

export function DialogContent({
  className,
  children,
  closeLabel = 'Закрыть',
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & { closeLabel?: string }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={overlayClass} />
      <DialogPrimitive.Content
        className={cn(dialogContentClass, className)}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          className={dialogCloseClass}
          aria-label={closeLabel}
        >
          <X aria-hidden="true" size={18} />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

export function DialogHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('grid gap-2 pr-6', className)} {...props} />
}

export function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn(dialogFooterClass, className)} {...props} />
}

export function DialogTitle({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn(dialogTitleClass, className)}
      {...props}
    />
  )
}

export function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn(dialogDescriptionClass, className)}
      {...props}
    />
  )
}
