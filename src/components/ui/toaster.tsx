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
          toast: 'guild-toast',
          description: 'guild-toast-description',
        },
      }}
    />
  )
}
