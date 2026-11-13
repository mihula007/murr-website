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
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

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
        if (!open) {
          blocker.reset?.()
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogTitle>Уйти без сохранения?</AlertDialogTitle>
        <AlertDialogDescription>
          Изменения на этой странице не сохранены и будут потеряны.
        </AlertDialogDescription>
        <AlertDialogFooter>
          {/* Безопасный выбор — главный: «Остаться» выделена и получает
              фокус, потеря изменений — второстепенное действие. */}
          <AlertDialogAction
            className={cn(
              buttonVariants({ variant: 'secondary' }),
              'text-destructive',
            )}
            onClick={() => blocker.proceed?.()}
          >
            Уйти без сохранения
          </AlertDialogAction>
          <AlertDialogCancel className={buttonVariants()}>
            Остаться
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  return { dialog, isBlocked }
}
