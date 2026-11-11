import { useState, type ReactNode } from 'react'
import { FormError } from '@/components/form/form-error'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { AppError, errorMessage } from '@/lib/errors'

type ConfirmActionDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description: ReactNode
  confirmLabel: string
  pendingLabel: string
  /** Действие; отказ показывается в диалоге, диалог остаётся открытым. */
  onConfirm: () => Promise<unknown>
}

/**
 * Подтверждение необратимого для пользователя действия (смена роли,
 * блокировка, восстановление). Пока действие выполняется, диалог не
 * закрывается; ошибка сервера выводится текстом из каталога.
 */
export function ConfirmActionDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pendingLabel,
  onConfirm,
}: ConfirmActionDialogProps) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function change(next: boolean) {
    if (pending) {
      return
    }
    setError(null)
    onOpenChange(next)
  }

  async function confirm() {
    setPending(true)
    setError(null)
    try {
      await onConfirm()
      setPending(false)
      onOpenChange(false)
    } catch (thrown) {
      setPending(false)
      setError(
        errorMessage(thrown instanceof AppError ? thrown.code : 'unknown'),
      )
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={change}>
      <AlertDialogContent>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
        <FormError message={error} />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Отмена</AlertDialogCancel>
          <Button
            type="button"
            disabled={pending}
            onClick={() => void confirm()}
          >
            {pending ? pendingLabel : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
