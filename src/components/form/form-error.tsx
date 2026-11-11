import { Notice } from '@/components/ui/surfaces'

/** Ошибка всей формы (`role="alert"`); без сообщения ничего не выводит. */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <Notice role="alert" className="border-destructive text-destructive">
      {message}
    </Notice>
  )
}
