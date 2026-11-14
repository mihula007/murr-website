import { useState } from 'react'
import type { EventDetails } from '@contracts/events'
import {
  GROUP_LIMITS,
  type GroupTemplate,
  type SaveGroupTemplateRequest,
} from '@contracts/groups'
import { ConfirmActionDialog } from '@/components/confirm-action-dialog'
import { EmptyState } from '@/components/states/empty-state'
import { ErrorState } from '@/components/states/error-state'
import { LoadingState } from '@/components/states/loading-state'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from '@/components/ui/toaster'
import { errorMessage, type AppError } from '@/lib/errors'
import {
  useApplyGroupTemplate,
  useDeleteGroupTemplate,
  useGroupTemplates,
} from '../groups-api'
import { GroupTemplateBuilder } from './group-template-builder'

type GroupTemplatesDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Актуальное событие: шаблон применяется к нему и сохраняется из него. */
  event?: EventDetails
}

function peopleCount(template: GroupTemplate) {
  return template.groups.reduce((sum, group) => sum + group.members.length, 0)
}

/** Текущее распределение события как начальные данные конструктора (GRP-14). */
function fromEvent(event: EventDetails): SaveGroupTemplateRequest {
  return {
    name: event.title,
    groups: event.groups.map((group) => ({
      name: group.name,
      members: group.members.map((member) => ({
        userId: member.userId,
        isLeader: member.isLeader,
      })),
    })),
  }
}

/**
 * Общая библиотека шаблонов групп (GRP-12–15): занятое количество из 20,
 * применение к событию с подтверждением замены, удаление, конструктор.
 */
export function GroupTemplatesDialog({
  open,
  onOpenChange,
  event,
}: GroupTemplatesDialogProps) {
  const templates = useGroupTemplates(open)
  const apply = useApplyGroupTemplate()
  const remove = useDeleteGroupTemplate()
  const [building, setBuilding] = useState<SaveGroupTemplateRequest | null>(
    null,
  )
  const [applying, setApplying] = useState<GroupTemplate | null>(null)
  const [deleting, setDeleting] = useState<GroupTemplate | null>(null)
  const count = templates.data?.items.length ?? 0
  const full = count >= GROUP_LIMITS.templates

  async function applyNow(template: GroupTemplate) {
    if (!event) {
      return
    }
    await apply.mutateAsync({
      eventId: event.id,
      input: { eventId: event.id, templateId: template.id },
    })
    toast(`Шаблон «${template.name}» применён: включены ответившие «Приду»`)
    onOpenChange(false)
  }

  function chooseApply(template: GroupTemplate) {
    if (event && event.groups.length > 0) {
      setApplying(template)
      return
    }
    applyNow(template).catch((error: unknown) =>
      toast(errorMessage((error as AppError).code)),
    )
  }

  let content
  if (templates.isPending) {
    content = <LoadingState label="Загружаем шаблоны…" rows={2} />
  } else if (templates.isError) {
    content = <ErrorState onRetry={() => void templates.refetch()} />
  } else if (templates.data.items.length === 0) {
    content = (
      <EmptyState
        title="Шаблонов пока нет"
        description="Соберите группы в конструкторе или сохраните распределение события."
      />
    )
  } else {
    content = (
      <ul aria-label="Шаблоны групп" className="m-0 grid list-none gap-2 p-0">
        {templates.data.items.map((template) => (
          <li
            key={template.id}
            className="grid min-w-0 gap-2 rounded-xl border border-border bg-surface-inset p-3"
          >
            <h3 className="m-0 font-sans text-base font-bold break-words">
              {template.name}
            </h3>
            <p className="m-0 text-sm text-muted-foreground">
              Групп: {template.groups.length} · людей: {peopleCount(template)} ·
              автор: {template.createdBy?.gameNickname ?? 'Пользователь удалён'}
            </p>
            <div className="grid grid-cols-2 gap-2 max-xs:grid-cols-1">
              {event ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={apply.isPending}
                  onClick={() => chooseApply(template)}
                >
                  Применить
                </Button>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="text-destructive"
                onClick={() => setDeleting(template)}
              >
                Удалить
              </Button>
            </div>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <>
      <Dialog open={open && building === null} onOpenChange={onOpenChange}>
        <DialogContent className="w-[min(calc(100vw-28px),560px)]">
          <DialogTitle>Шаблоны групп</DialogTitle>
          <DialogDescription>
            Общие для офицеров и администраторов: {count} из{' '}
            {GROUP_LIMITS.templates}. При применении шаблон заменяет текущие
            группы; включаются только ответившие «Приду».
          </DialogDescription>
          <div className="grid grid-cols-2 gap-2 max-xs:grid-cols-1">
            <Button
              type="button"
              disabled={full}
              onClick={() => setBuilding({ name: '', groups: [] })}
            >
              Новый шаблон
            </Button>
            {event ? (
              <Button
                type="button"
                variant="secondary"
                disabled={full || event.groups.length === 0}
                onClick={() => setBuilding(fromEvent(event))}
              >
                Сохранить как шаблон
              </Button>
            ) : null}
          </div>
          {full ? (
            <p className="m-0 text-sm text-muted-foreground">
              Достигнут лимит {GROUP_LIMITS.templates} шаблонов: удалите
              ненужные.
            </p>
          ) : null}
          {content}
        </DialogContent>
      </Dialog>
      {building !== null ? (
        <GroupTemplateBuilder
          initial={building}
          onClose={() => setBuilding(null)}
        />
      ) : null}
      <ConfirmActionDialog
        open={applying !== null}
        onOpenChange={(next) => {
          if (!next) {
            setApplying(null)
          }
        }}
        title={`Применить «${applying?.name ?? ''}»?`}
        description="Текущие группы события будут заменены. Ответы участников не изменятся."
        confirmLabel="Заменить группы"
        pendingLabel="Применяем…"
        onConfirm={async () => {
          if (applying) {
            await applyNow(applying)
          }
        }}
      />
      <ConfirmActionDialog
        open={deleting !== null}
        onOpenChange={(next) => {
          if (!next) {
            setDeleting(null)
          }
        }}
        title={`Удалить шаблон «${deleting?.name ?? ''}»?`}
        description="Шаблон исчезнет у всех офицеров и администраторов. Группы событий не изменятся."
        confirmLabel="Удалить"
        pendingLabel="Удаляем…"
        onConfirm={async () => {
          if (deleting) {
            await remove.mutateAsync(deleting.id)
            toast('Шаблон удалён')
          }
        }}
      />
    </>
  )
}
