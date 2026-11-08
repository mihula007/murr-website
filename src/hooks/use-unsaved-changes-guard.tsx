import { useBlocker } from '@tanstack/react-router'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

/**
 * Защита от потери несохранённых данных (Q-17). Пока `isDirty`, внутренний
 * переход ждёт подтверждения, а закрытие вкладки вызывает `beforeunload`.
 * Возвращённый `dialog` нужно отрендерить рядом с формой.
 */
export function useUnsavedChangesGuard(isDirty: boolean) {
  const blocker = useBlocker({
    shouldBlockFn: () => isDirty,
    enableBeforeUnload: isDirty,
    withResolver: true,
  })
  const isBlocked = blocker.status === 'blocked'

  const dialog = (
    <AlertDialog
      open={isBlocked}
      onOpenChange={(open) => {
        if (!open) blocker.reset?.()
      }}
    >
      <AlertDialogContent>
        <AlertDialogTitle>Уйти без сохранения?</AlertDialogTitle>
        <AlertDialogDescription>
          Изменения на этой странице не сохранены и будут потеряны.
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel>Остаться</AlertDialogCancel>
          <AlertDialogAction onClick={() => blocker.proceed?.()}>
            Уйти
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  return { dialog, isBlocked }
}
