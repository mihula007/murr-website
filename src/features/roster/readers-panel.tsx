import { useState } from 'react'
import type { RosterMember } from '@contracts/roster'
import { ROLE_LABELS } from '@/app/access'
import { ConfirmActionDialog } from '@/components/confirm-action-dialog'
import { ErrorState } from '@/components/states/error-state'
import { LoadingState } from '@/components/states/loading-state'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MoreHorizontal } from 'lucide-react'
import { Card } from '@/components/ui/surfaces'
import { toast } from '@/components/ui/toaster'
import { pagingOf, VirtualList } from '@/components/virtual-list'
import { ClassIcon } from '@/features/catalog/class-icon'
import { useReaders, useRestoreReader } from './api'

const MASTER_ROLE_CHOICES = ['member', 'officer', 'applicant'] as const
type MasterRole = (typeof MASTER_ROLE_CHOICES)[number]

/** Чтецы и их восстановление в клане для офицера и администратора (ACL-06). */
export function ReadersPanel({
  canManageRoles = false,
  onChangeRole,
}: {
  canManageRoles?: boolean
  onChangeRole?: (reader: RosterMember, role: MasterRole) => void
}) {
  const readers = useReaders()
  const restore = useRestoreReader()
  const [restoring, setRestoring] = useState<RosterMember | null>(null)

  let content
  if (readers.isPending) {
    content = <LoadingState label="Загружаем чтецов…" rows={2} />
  } else if (readers.isError) {
    content = <ErrorState onRetry={() => void readers.refetch()} />
  } else if (readers.data.length === 0) {
    content = <p className="text-muted-foreground">Чтецов нет.</p>
  } else {
    content = (
      <VirtualList
        label="Чтецы"
        items={readers.data}
        getKey={(reader) => reader.id}
        estimateSize={66}
        paging={pagingOf(readers)}
        renderItem={(reader) => (
          <div className="flex min-w-0 flex-wrap items-center gap-3 rounded-xl border border-border bg-surface-inset p-3 max-xs:grid max-xs:grid-cols-1">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <Avatar
                size="sm"
                name={reader.gameNickname}
                src={reader.avatarUrl}
                alt=""
              />
              <span className="grid min-w-0 gap-0.5">
                <strong className="break-words">{reader.gameNickname}</strong>
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <ClassIcon
                    classId={reader.classId}
                    className={reader.className}
                    wrapperClassName="size-[21px]"
                  />
                  {reader.className}
                </span>
              </span>
            </div>
            {canManageRoles ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="flex-none px-2"
                    aria-label={`Действия с чтецом «${reader.gameNickname}»`}
                  >
                    <MoreHorizontal size={18} aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {MASTER_ROLE_CHOICES.map((role) => (
                    <DropdownMenuItem
                      key={role}
                      onSelect={() => onChangeRole?.(reader, role)}
                    >
                      Назначить роль «{ROLE_LABELS[role]}»
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setRestoring(reader)}
              >
                Восстановить в клане
              </Button>
            )}
          </div>
        )}
      />
    )
  }

  return (
    <Card className="grid gap-3">
      <div className="grid gap-1">
        <h2 className="text-xl font-bold">Чтецы</h2>
        <p className="text-sm text-muted-foreground">
          Бывшие участники с доступом только к своему профилю. Восстановление
          возвращает роль члена клана с датой вступления — сегодня.
        </p>
      </div>
      {content}
      <ConfirmActionDialog
        open={restoring !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRestoring(null)
          }
        }}
        title={`Восстановить ${restoring?.gameNickname ?? ''} в клане?`}
        description="Чтец снова станет членом клана, дата вступления — сегодня. Действие записывается в журнал аудита."
        confirmLabel="Восстановить"
        pendingLabel="Восстанавливаем…"
        onConfirm={async () => {
          if (!restoring) {
            return
          }
          await restore.mutateAsync({ userId: restoring.id })
          toast(`${restoring.gameNickname} снова в клане`)
        }}
      />
    </Card>
  )
}
