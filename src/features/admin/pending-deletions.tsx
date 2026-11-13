import { useState } from 'react'
import type { PendingDeletion } from '@contracts/accounts'
import { ConfirmActionDialog } from '@/components/confirm-action-dialog'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/surfaces'
import { toast } from '@/components/ui/toaster'
import { formatDateTimeMsk } from '@/lib/format-date'
import { useDeleteAccount, usePendingDeletions } from './api'

const STAGE_LABELS: Record<PendingDeletion['stage'], string> = {
  files: 'файлы',
  database: 'данные сайта',
  auth: 'учётная запись входа',
}

/**
 * Незавершённые удаления (Q-74): доступ аккаунта закрыт, администратор
 * повторяет удаление кнопкой. Блок виден, только если такие есть.
 */
export function PendingDeletions() {
  const pending = usePendingDeletions()
  const remove = useDeleteAccount()
  const [retry, setRetry] = useState<PendingDeletion | null>(null)
  const items = pending.data?.items ?? []
  if (items.length === 0) {
    return null
  }
  return (
    <Notice className="grid gap-3">
      <section aria-label="Незавершённые удаления" className="grid gap-3">
        <strong>Удаление не завершено</strong>
        <ul className="m-0 grid list-none gap-2 p-0">
          {items.map((item) => (
            <li
              key={item.userId}
              className="flex flex-wrap items-center justify-between gap-3"
            >
              <span className="min-w-0 break-words">
                <b>{item.nickname}</b> · {item.email} · остановилось на этапе «
                {STAGE_LABELS[item.stage]}», {formatDateTimeMsk(item.updatedAt)}
              </span>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setRetry(item)}
              >
                Повторить
              </Button>
            </li>
          ))}
        </ul>
        {pending.data?.truncated ? (
          <span className="text-xs">Показана часть списка.</span>
        ) : null}
        <ConfirmActionDialog
          open={retry !== null}
          onOpenChange={(open) => {
            if (!open) {
              setRetry(null)
            }
          }}
          title={`Продолжить удаление ${retry?.nickname ?? ''}?`}
          description="Удаление продолжится с остановившегося этапа. Уже удалённое не восстанавливается."
          confirmLabel="Повторить"
          pendingLabel="Удаляем…"
          onConfirm={async () => {
            if (!retry) {
              return
            }
            await remove.mutateAsync({
              userId: retry.userId,
              confirmNickname: retry.nickname,
            })
            toast(`${retry.nickname}: пользователь удалён`)
          }}
        />
      </section>
    </Notice>
  )
}
