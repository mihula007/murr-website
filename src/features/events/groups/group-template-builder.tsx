import { useState } from 'react'
import { useForm, useStore } from '@tanstack/react-form'
import { ArrowDown, ArrowUp, Crown, Plus, X } from 'lucide-react'
import {
  GROUP_LIMITS,
  saveGroupTemplateSchema,
  type SaveGroupTemplateRequest,
} from '@contracts/groups'
import type { RosterMember } from '@contracts/roster'
import { focusFirstInvalid } from '@/components/form/focus-first-invalid'
import { FormError } from '@/components/form/form-error'
import { FormField, fieldAria, fieldError } from '@/components/form/form-field'
import { ErrorState } from '@/components/states/error-state'
import { LoadingState } from '@/components/states/loading-state'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toaster'
import { ClassIcon } from '@/features/catalog/class-icon'
import { useRoster } from '@/features/roster/api'
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard'
import { errorMessage, fieldMessage, type AppError } from '@/lib/errors'
import { useSaveGroupTemplate } from '../groups-api'

type TemplateValues = {
  name: string
  groups: { name: string; members: { userId: string; isLeader: boolean }[] }[]
}

function normalize(initial: SaveGroupTemplateRequest): TemplateValues {
  return {
    name: initial.name,
    groups: initial.groups.map((group) => ({
      name: group.name,
      members: group.members.map((member) => ({
        userId: member.userId,
        isLeader: member.isLeader,
      })),
    })),
  }
}

const iconButton = 'size-8 flex-none'

type BuilderBodyProps = {
  initial: SaveGroupTemplateRequest
  roster: RosterMember[]
  onClose: () => void
}

function BuilderBody({ initial, roster, onClose }: BuilderBodyProps) {
  const save = useSaveGroupTemplate()
  const [serverError, setServerError] = useState<AppError | null>(null)
  const [search, setSearch] = useState('')
  const people = new Map(roster.map((member) => [member.id, member]))

  const form = useForm({
    defaultValues: normalize(initial),
    validators: { onChange: saveGroupTemplateSchema },
    onSubmitInvalid: focusFirstInvalid,
    onSubmit: async ({ value }) => {
      setServerError(null)
      try {
        await save.mutateAsync(saveGroupTemplateSchema.parse(value))
        toast('Шаблон групп сохранён')
        onClose()
      } catch (error) {
        setServerError(error as AppError)
      }
    },
  })
  const groups = useStore(form.store, (state) => state.values.groups)
  const isDirty = useStore(form.store, (state) => state.isDirty)
  const { dialog } = useUnsavedChangesGuard(isDirty)

  const update = (
    change: (draft: TemplateValues['groups']) => TemplateValues['groups'],
  ) => form.setFieldValue('groups', (current) => change(current))

  const assigned = new Set(
    groups.flatMap((group) => group.members.map((member) => member.userId)),
  )
  const query = search.trim().toLocaleLowerCase('ru-RU')
  const free = roster.filter(
    (member) =>
      !assigned.has(member.id) &&
      (!query ||
        `${member.gameNickname} ${member.className}`
          .toLocaleLowerCase('ru-RU')
          .includes(query)),
  )

  function addTo(groupIndex: number, userId: string) {
    update((current) =>
      current.map((group, index) =>
        index === groupIndex
          ? {
              ...group,
              members: [...group.members, { userId, isLeader: false }],
            }
          : group,
      ),
    )
  }

  function moveWithin(groupIndex: number, from: number, to: number) {
    update((current) =>
      current.map((group, index) => {
        if (index !== groupIndex) {
          return group
        }
        const members = [...group.members]
        const [moved] = members.splice(from, 1)
        members.splice(to, 0, moved!)
        return { ...group, members }
      }),
    )
  }

  function removeMember(groupIndex: number, userId: string) {
    update((current) =>
      current.map((group, index) =>
        index === groupIndex
          ? {
              ...group,
              members: group.members.filter((m) => m.userId !== userId),
            }
          : group,
      ),
    )
  }

  function toggleLeader(groupIndex: number, userId: string) {
    update((current) =>
      current.map((group, index) =>
        index === groupIndex
          ? {
              ...group,
              members: group.members.map((member) => ({
                ...member,
                isLeader: member.userId === userId ? !member.isLeader : false,
              })),
            }
          : group,
      ),
    )
  }

  const limitError =
    serverError?.fields.limit === 'too_many'
      ? `В библиотеке уже ${GROUP_LIMITS.templates} шаблонов: удалите ненужные`
      : serverError?.fields.groups
        ? fieldMessage(serverError.fields.groups)
        : serverError && Object.keys(serverError.fields).length === 0
          ? errorMessage(serverError.code)
          : null

  return (
    <form
      noValidate
      aria-label="Конструктор шаблона групп"
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <form.Subscribe selector={(state) => state.submissionAttempts > 0}>
        {(submitted) => (
          <>
            <form.Field name="name">
              {(field) => {
                const error = fieldError(
                  field.state.meta,
                  submitted,
                  serverError?.fields.name,
                )
                return (
                  <FormField
                    id="group-template-name"
                    label="Название шаблона"
                    error={error}
                  >
                    <Input
                      {...fieldAria('group-template-name', error)}
                      maxLength={GROUP_LIMITS.templateName}
                      value={field.state.value}
                      onChange={(change) =>
                        field.handleChange(change.target.value)
                      }
                      onBlur={field.handleBlur}
                    />
                  </FormField>
                )
              }}
            </form.Field>
            {submitted && groups.length === 0 ? (
              <FormError message="Добавьте хотя бы одну группу" />
            ) : null}
            <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
              <section aria-label="Группы шаблона" className="grid gap-3">
                {groups.map((group, groupIndex) => (
                  <div
                    // Группы шаблона не имеют id: порядок задаёт пользователь.
                    // oxlint-disable-next-line react/no-array-index-key
                    key={groupIndex}
                    className="grid gap-2 rounded-xl border border-border bg-surface-inset p-3"
                  >
                    <div className="flex items-end gap-2">
                      <form.Field name={`groups[${groupIndex}].name`}>
                        {(field) => {
                          const id = `template-group-${groupIndex}`
                          const error = fieldError(field.state.meta, submitted)
                          return (
                            <FormField
                              id={id}
                              label={`Группа ${groupIndex + 1}`}
                              error={error}
                              className="min-w-0 flex-1"
                            >
                              <Input
                                {...fieldAria(id, error)}
                                maxLength={GROUP_LIMITS.name}
                                value={field.state.value}
                                onChange={(change) =>
                                  field.handleChange(change.target.value)
                                }
                                onBlur={field.handleBlur}
                              />
                            </FormField>
                          )
                        }}
                      </form.Field>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Удалить группу ${groupIndex + 1}`}
                        onClick={() =>
                          update((current) =>
                            current.filter((_, index) => index !== groupIndex),
                          )
                        }
                      >
                        <X size={16} aria-hidden="true" />
                      </Button>
                    </div>
                    {group.members.length === 0 ? (
                      <p className="m-0 text-sm text-muted-foreground">
                        Добавьте участников из состава.
                      </p>
                    ) : (
                      <ol className="m-0 grid list-none gap-1 p-0">
                        {group.members.map((member, index) => {
                          const person = people.get(member.userId)
                          const name =
                            person?.gameNickname ?? 'Выбыл из состава'
                          return (
                            <li
                              key={member.userId}
                              className="flex min-w-0 items-center gap-1.5"
                            >
                              <span className="w-6 text-sm font-bold text-primary tabular-nums">
                                {index + 1}.
                              </span>
                              {person ? (
                                <ClassIcon
                                  classId={person.classId}
                                  className={person.className}
                                />
                              ) : null}
                              <span className="min-w-0 flex-1 text-sm break-words">
                                {name}
                                {member.isLeader ? (
                                  <span className="text-primary">
                                    {' '}
                                    — Пати лидер
                                  </span>
                                ) : null}
                              </span>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className={iconButton}
                                aria-pressed={member.isLeader}
                                aria-label={`Лидер: ${name}`}
                                onClick={() =>
                                  toggleLeader(groupIndex, member.userId)
                                }
                              >
                                <Crown size={14} aria-hidden="true" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className={iconButton}
                                disabled={index === 0}
                                aria-label={`Выше: ${name}`}
                                onClick={() =>
                                  moveWithin(groupIndex, index, index - 1)
                                }
                              >
                                <ArrowUp size={14} aria-hidden="true" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className={iconButton}
                                disabled={index === group.members.length - 1}
                                aria-label={`Ниже: ${name}`}
                                onClick={() =>
                                  moveWithin(groupIndex, index, index + 1)
                                }
                              >
                                <ArrowDown size={14} aria-hidden="true" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className={iconButton}
                                aria-label={`Убрать: ${name}`}
                                onClick={() =>
                                  removeMember(groupIndex, member.userId)
                                }
                              >
                                <X size={14} aria-hidden="true" />
                              </Button>
                            </li>
                          )
                        })}
                      </ol>
                    )}
                  </div>
                ))}
                <Button
                  type="button"
                  variant="secondary"
                  disabled={groups.length >= GROUP_LIMITS.groups}
                  onClick={() =>
                    update((current) => [
                      ...current,
                      { name: `Пати ${current.length + 1}`, members: [] },
                    ])
                  }
                >
                  <Plus size={16} aria-hidden="true" /> Добавить группу
                </Button>
              </section>
              <section aria-label="Состав клана" className="grid gap-2">
                <Input
                  type="search"
                  aria-label="Поиск в составе"
                  placeholder="Поиск по нику или классу"
                  value={search}
                  onChange={(change) => setSearch(change.target.value)}
                />
                {free.length === 0 ? (
                  <p className="m-0 text-sm text-muted-foreground">
                    Никого нет.
                  </p>
                ) : (
                  <ul
                    aria-label="Свободные участники"
                    className="m-0 grid max-h-[360px] list-none gap-1 overflow-y-auto p-0"
                  >
                    {free.map((member) => (
                      <li
                        key={member.id}
                        className="flex min-w-0 items-center gap-2 rounded-lg border border-border px-2 py-1"
                      >
                        <ClassIcon
                          classId={member.classId}
                          className={member.className}
                        />
                        <span className="min-w-0 flex-1 text-sm break-words">
                          {member.gameNickname}
                        </span>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={groups.length === 0}
                              aria-label={`Добавить ${member.gameNickname} в группу`}
                            >
                              <Plus size={14} aria-hidden="true" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>В группу</DropdownMenuLabel>
                            {groups.map((group, index) => (
                              <DropdownMenuItem
                                // oxlint-disable-next-line react/no-array-index-key
                                key={index}
                                onSelect={() => addTo(index, member.id)}
                              >
                                {group.name || `Группа ${index + 1}`}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </>
        )}
      </form.Subscribe>
      <FormError message={limitError} />
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(isSubmitting) => (
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              Отмена
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Сохраняем…' : 'Сохранить шаблон'}
            </Button>
          </DialogFooter>
        )}
      </form.Subscribe>
      {dialog}
    </form>
  )
}

/**
 * Конструктор шаблона групп (GRP-13, GRP-14): весь текущий состав (Q-48)
 * с поиском, именованные группы, порядок и лидеры. Шаблон — копия.
 */
export function GroupTemplateBuilder({
  initial,
  onClose,
}: {
  initial: SaveGroupTemplateRequest
  onClose: () => void
}) {
  const roster = useRoster()
  let content
  if (roster.isPending) {
    content = <LoadingState label="Загружаем состав…" rows={2} />
  } else if (roster.isError) {
    content = <ErrorState onRetry={() => void roster.refetch()} />
  } else {
    content = (
      <BuilderBody
        initial={initial}
        roster={roster.data.items}
        onClose={onClose}
      />
    )
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose()
        }
      }}
    >
      <DialogContent className="w-[min(calc(100vw-28px),880px)]">
        <DialogTitle>Шаблон групп</DialogTitle>
        <DialogDescription>
          Нужны название и хотя бы одна группа. При применении шаблона в событие
          попадут только ответившие «Приду».
        </DialogDescription>
        {content}
      </DialogContent>
    </Dialog>
  )
}
