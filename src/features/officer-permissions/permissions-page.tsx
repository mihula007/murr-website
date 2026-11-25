import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm, useStore } from '@tanstack/react-form'
import { z } from 'zod'
import {
  OFFICER_PERMISSION_CODES,
  OFFICER_PERMISSION_LABELS,
  officerPermissionCodeSchema,
  type OfficerPermissionCode,
} from '@contracts/officer-permissions'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/surfaces'
import { Select } from '@/components/ui/select'
import { EmptyState } from '@/components/states/empty-state'
import { ErrorState } from '@/components/states/error-state'
import { LoadingState } from '@/components/states/loading-state'
import { FormError } from '@/components/form/form-error'
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard'
import { formErrorMessage } from '@/lib/errors'
import { toast } from '@/components/ui/toaster'
import { useOfficerPermissionsRoster, useSaveOfficerPermissions } from './api'
import { PermissionSwitch } from './permission-switch'

const APPLICATION_ACTIONS: readonly OfficerPermissionCode[] = [
  'applications.submit_vote',
  'applications.decide_after_vote',
  'applications.decide_direct',
]

const permissionFormSchema = z.object({
  permissions: z
    .array(officerPermissionCodeSchema)
    .refine((values) => new Set(values).size === values.length, 'duplicate')
    .refine(
      (values) =>
        values.includes('applications.review') ||
        !APPLICATION_ACTIONS.some((code) => values.includes(code)),
      'applications_review_required',
    ),
})

const PERMISSION_GROUPS: ReadonlyArray<{
  title: string
  permissions: readonly OfficerPermissionCode[]
}> = [
  {
    title: 'Заявки',
    permissions: [
      'applications.review',
      'applications.submit_vote',
      'applications.decide_after_vote',
      'applications.decide_direct',
    ],
  },
  {
    title: 'Рассылки',
    permissions: [
      'broadcasts.send',
      'broadcasts.templates',
      'broadcasts.subscriptions',
    ],
  },
  {
    title: 'Ивенты и группы',
    permissions: [
      'events.manage',
      'events.view_full_roster',
      'events.templates',
      'events.delete_own',
      'groups.manage',
      'groups.templates',
      'events.close',
    ],
  },
  {
    title: 'Голосования',
    permissions: [
      'votes.manage',
      'votes.complete_delete',
      'votes.view_ballots',
    ],
  },
  {
    title: 'Состав и активность',
    permissions: [
      'roster.reader_roles',
      'activity.view_export',
      'activity.correct_rating',
      'activity.correct_summary',
    ],
  },
  {
    title: 'Публикации и рынок',
    permissions: ['publications.manage_own'],
  },
]

const emptyPermissions: OfficerPermissionCode[] = []

/** Настройка индивидуальных полномочий офицеров (OFP-01–13). */
export function OfficerPermissionsPage() {
  const roster = useOfficerPermissionsRoster()
  const save = useSaveOfficerPermissions()
  const [selectedOfficerId, setSelectedOfficerId] = useState<string | null>(
    null,
  )
  const [pendingOfficerId, setPendingOfficerId] = useState<string | null>(null)
  const activeOfficerId = useRef<string | null>(null)
  const officers = useMemo(
    () => roster.data?.officers ?? [],
    [roster.data?.officers],
  )
  const selectedOfficer = officers.find(
    (officer) => officer.id === selectedOfficerId,
  )
  const form = useForm({
    defaultValues: {
      permissions: selectedOfficer?.permissions ?? emptyPermissions,
    },
    validators: { onChange: permissionFormSchema },
    onSubmit: async ({ value }) => {
      if (!selectedOfficerId) {
        return
      }
      const input = permissionFormSchema.parse(value)
      try {
        const result = await save.mutateAsync({
          officerId: selectedOfficerId,
          permissions: input.permissions,
        })
        form.reset({ permissions: result.permissions })
        toast('Права сохранены')
      } catch {
        // Ошибка остаётся в save.error и показывается под списком прав.
      }
    },
  })
  const isDirty = useStore(form.store, (state) => state.isDirty)
  const { dialog } = useUnsavedChangesGuard(isDirty)
  useEffect(() => {
    if (!selectedOfficerId && officers[0]) {
      setSelectedOfficerId(officers[0].id)
    }
  }, [officers, selectedOfficerId])

  function activateOfficer(officerId: string) {
    const officer = officers.find((item) => item.id === officerId)
    if (!officer) {
      return
    }
    activeOfficerId.current = officerId
    setSelectedOfficerId(officerId)
    setPendingOfficerId(null)
    save.reset()
    form.reset({ permissions: officer.permissions })
  }

  useEffect(() => {
    if (
      selectedOfficerId &&
      selectedOfficerId !== activeOfficerId.current &&
      officers.some((officer) => officer.id === selectedOfficerId)
    ) {
      activateOfficer(selectedOfficerId)
    }
    // Selection changes are applied through activateOfficer; don't reset on a background refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOfficerId, officers])

  if (roster.isPending) {
    return <LoadingState label="Загружаем офицеров…" />
  }
  if (roster.isError) {
    return (
      <ErrorState
        message="Не удалось загрузить список офицеров. Попробуйте ещё раз."
        onRetry={() => void roster.refetch()}
      />
    )
  }

  if (officers.length === 0) {
    return (
      <main className="mx-auto grid w-full max-w-[960px] gap-5 px-4 py-6">
        <PageHeading />
        <EmptyState
          title="Пока нет офицеров"
          description="Когда в клане появится офицер, здесь можно будет настроить его права."
        />
      </main>
    )
  }

  return (
    <main className="mx-auto grid w-full max-w-[960px] gap-5 px-4 py-6">
      {dialog}
      <PageHeading />
      <Card className="grid gap-5 p-4 sm:p-5">
        <div className="grid gap-2">
          <label
            htmlFor="officer-permissions-target"
            className="text-sm font-semibold"
          >
            Офицер
          </label>
          <Select
            id="officer-permissions-target"
            aria-label="Выбрать офицера"
            value={selectedOfficerId ?? undefined}
            options={officers.map((officer) => ({
              value: officer.id,
              label: officer.nickname,
            }))}
            disabled={save.isPending}
            onValueChange={(nextId) => {
              if (nextId === selectedOfficerId) {
                return
              }
              if (isDirty) {
                setPendingOfficerId(nextId)
                return
              }
              activateOfficer(nextId)
            }}
          />
        </div>

        <form
          noValidate
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault()
            void form.handleSubmit()
          }}
        >
          <form.Subscribe selector={(state) => state.values.permissions}>
            {(permissions) => {
              const enabled = new Set(permissions)
              return (
                <div className="grid gap-5">
                  {PERMISSION_GROUPS.map((group, groupIndex) => (
                    <section
                      key={group.title}
                      className="grid gap-3"
                      aria-labelledby={`permission-group-${groupIndex}`}
                    >
                      <h2
                        id={`permission-group-${groupIndex}`}
                        className="border-b border-border pb-2 text-lg font-bold"
                      >
                        {group.title}
                      </h2>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {group.permissions.map((code) => {
                          const needsReview = APPLICATION_ACTIONS.includes(code)
                          return (
                            <PermissionSwitch
                              key={code}
                              id={`officer-permission-${code.replaceAll('.', '-')}`}
                              label={OFFICER_PERMISSION_LABELS[code]}
                              checked={enabled.has(code)}
                              disabled={
                                needsReview &&
                                !enabled.has('applications.review')
                              }
                              onChange={(checked) => {
                                const next = new Set(permissions)
                                if (checked) {
                                  next.add(code)
                                } else {
                                  next.delete(code)
                                }
                                if (
                                  code === 'applications.review' &&
                                  !checked
                                ) {
                                  APPLICATION_ACTIONS.forEach((action) =>
                                    next.delete(action),
                                  )
                                }
                                form.setFieldValue(
                                  'permissions',
                                  OFFICER_PERMISSION_CODES.filter((item) =>
                                    next.has(item),
                                  ),
                                )
                              }}
                            />
                          )
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              )
            }}
          </form.Subscribe>

          <FormError message={formErrorMessage(save.error)} />
          <div className="flex justify-end border-t border-border pt-4">
            <Button type="submit" disabled={!isDirty || save.isPending}>
              {save.isPending ? 'Сохраняем…' : 'Сохранить'}
            </Button>
          </div>
        </form>
      </Card>

      <AlertDialog
        open={pendingOfficerId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingOfficerId(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>Переключить офицера?</AlertDialogTitle>
          <AlertDialogDescription>
            Несохранённые права будут отброшены.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Остаться</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingOfficerId) {
                  activateOfficer(pendingOfficerId)
                }
              }}
            >
              Переключить офицера
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  )
}

function PageHeading() {
  return (
    <header className="grid gap-1">
      <h1 className="text-3xl font-bold">Мастерка</h1>
      <p className="max-w-2xl text-sm text-muted-foreground">
        Настройте, какие действия доступны каждому офицеру. Новые права
        выключены, пока вы их не сохраните.
      </p>
    </header>
  )
}
