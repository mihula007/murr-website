import { Toaster as Sonner, toast } from 'sonner'

export { toast }

export function Toaster() {
  return (
    <Sonner
      theme="dark"
      position="bottom-center"
      closeButton
      toastOptions={{
        classNames: {
          toast: 'border-border-strong! bg-popover! text-foreground!',
          description: 'text-muted-foreground!',
        },
      }}
    />
  )
}
