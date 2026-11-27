import { useEffect, useState } from 'react'
import { useForm, useStore } from '@tanstack/react-form'
import { ArrowDown, ArrowUp, Crown, Plus, X } from 'lucide-react'
import {
  GROUP_LIMITS,
  saveGroupTemplateSchema,
  type SaveGroupTemplateRequest,
} from '@contracts/groups'
import {
  CHARACTER_STAT_FIELDS,
  CHARACTER_STAT_LABELS,
} from '@contracts/character-stats'
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
import { Select } from '@/components/ui/select'
import { toast } from '@/components/ui/toaster'
import { ClassIcon } from '@/features/catalog/class-icon'
import { useClasses } from '@/features/catalog/use-classes'
import { pagingOf, ScrollableVirtualList } from '@/components/virtual-list'
import { useTemplateRosterPages } from '@/features/roster/api'
import { formatCharacterStat } from '@/features/roster/character-stats'
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard'
import { errorMessage, fieldMessage, type AppError } from '@/lib/errors'
import { useSaveGroupTemplate } from '../groups-api'

type TemplateValues = {
  id?: string | undefined
  name: string
  groups: { name: string; members: { userId: string; isLeader: boolean }[] }[]
}

export type TemplateBuilderPerson = Pick<
  RosterMember,
  | 'id'
  | 'gameNickname'
  | 'classId'
  | 'className'
  | 'pa'
  | 'pz'
  | 'bu'
  | 'hp'
  | 'bd'
>

function useDebouncedValue(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return debounced
}

function StatValues({
  person,
  className,
}: {
  person: TemplateBuilderPerson
  className?: string
}) {
  return (
    <span
      className={`grid grid-cols-5 gap-x-2 text-[10px] leading-tight text-muted-foreground ${className ?? ''}`}
    >
      {CHARACTER_STAT_FIELDS.map((field) => (
        <span key={field} className="grid min-w-0">
          <span>{CHARACTER_STAT_LABELS[field]}</span>
          <strong className="font-medium text-foreground tabular-nums">
            {formatCharacterStat(field, person[field])}
          </strong>
        </span>
      ))}
    </span>
  )
}

function normalize(initial: SaveGroupTemplateRequest): TemplateValues {
  return {
    id: initial.id,
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
  initialPeople: TemplateBuilderPerson[]
  onClose: () => void
}

function BuilderBody({ initial, initialPeople, onClose }: BuilderBodyProps) {
  const save = useSaveGroupTemplate()
  const [serverError, setServerError] = useState<AppError | null>(null)
  const [search, setSearch] = useState('')
  const [classId, setClassId] = useState<number | null>(null)
  const debouncedSearch = useDebouncedValue(search, 350)
  const rosterQuery = useTemplateRosterPages({
    classId,
    search: debouncedSearch,
  })
  const classes = useClasses()
  const roster = rosterQuery.data?.pages.flatMap((page) => page.items) ?? []
  const people = new Map(
    [...initialPeople, ...roster].map((member) => [member.id, member]),
  )

  const form = useForm({
    defaultValues: normalize(initial),
    validators: { onChange: saveGroupTemplateSchema },
    onSubmitInvalid: focusFirstInvalid,
    onSubmit: async ({ value }) => {
      setServerError(null)
      try {
        await save.mutateAsync(saveGroupTemplateSchema.parse(value))
        toast(initial.id ? 'Шаблон групп обновлён' : 'Шаблон групп сохранён')
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
  const free = roster.filter((member) => !assigned.has(member.id))

  function addTo(groupIndex: number, userId: string) {
    if ((groups[groupIndex]?.members.length ?? 0) >= GROUP_LIMITS.members) {
      toast(`В группе может быть не больше ${GROUP_LIMITS.members} участников`)
      return
    }
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
            <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
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
                      <ol
                        aria-label={`Участники группы ${group.name || groupIndex + 1}`}
                        className="m-0 grid list-none gap-2 p-0"
                      >
                        {group.members.map((member, index) => {
                          const person = people.get(member.userId)
                          const name =
                            person?.gameNickname ?? 'Выбыл из состава'
                          return (
                            <li
                              key={member.userId}
                              className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-1.5 gap-y-1"
                            >
                              <div className="col-span-full flex min-w-0 items-center gap-1.5">
                                <span className="w-6 flex-none text-sm font-bold text-primary tabular-nums">
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
                              </div>
                              {person ? (
                                <StatValues
                                  person={person}
                                  className="col-span-full ml-7"
                                />
                              ) : null}
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
              <section aria-label="Состав клана" className="grid min-w-0 gap-2">
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem]">
                  <Input
                    type="search"
                    aria-label="Поиск в составе"
                    placeholder="Поиск по нику или классу"
                    value={search}
                    onChange={(change) => setSearch(change.target.value)}
                  />
                  <Select
                    aria-label="Фильтр по классу"
                    value={classId === null ? 'all' : String(classId)}
                    onValueChange={(value) =>
                      setClassId(value === 'all' ? null : Number(value))
                    }
                    options={[
                      { value: 'all', label: 'Все классы' },
                      ...(classes.data ?? []).map((item) => ({
                        value: String(item.id),
                        label: item.name,
                      })),
                    ]}
                  />
                </div>
                {rosterQuery.isPending ? (
                  <LoadingState label="Загружаем состав…" rows={2} />
                ) : rosterQuery.isError ? (
                  <ErrorState onRetry={() => void rosterQuery.refetch()} />
                ) : free.length === 0 && !rosterQuery.hasNextPage ? (
                  <p className="m-0 text-sm text-muted-foreground">
                    Никого нет.
                  </p>
                ) : (
                  <ScrollableVirtualList
                    items={free}
                    getKey={(member) => member.id}
                    label="Свободные участники"
                    estimateSize={82}
                    viewportRows={6}
                    paging={pagingOf(rosterQuery)}
                    renderItem={(member) => (
                      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-1 rounded-lg border border-border px-2 py-1.5">
                        <div className="flex min-w-0 items-center gap-2">
                          <ClassIcon
                            classId={member.classId}
                            className={member.className}
                          />
                          <span className="min-w-0 text-sm break-words">
                            {member.gameNickname}
                          </span>
                        </div>
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
                            {groups.map((group, index) => {
                              const full =
                                group.members.length >= GROUP_LIMITS.members
                              return (
                                <DropdownMenuItem
                                  // oxlint-disable-next-line react/no-array-index-key
                                  key={index}
                                  disabled={full}
                                  onSelect={() => addTo(index, member.id)}
                                >
                                  {group.name || `Группа ${index + 1}`}
                                  {full ? ' · максимум 50' : ''}
                                </DropdownMenuItem>
                              )
                            })}
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <StatValues person={member} className="col-span-full" />
                      </div>
                    )}
                  />
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
  initialPeople,
  onClose,
}: {
  initial: SaveGroupTemplateRequest
  initialPeople: TemplateBuilderPerson[]
  onClose: () => void
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose()
        }
      }}
    >
      <DialogContent className="w-[min(calc(100vw-28px),1440px)]">
        <DialogTitle>
          {initial.id ? 'Редактировать шаблон групп' : 'Шаблон групп'}
        </DialogTitle>
        <DialogDescription>
          Нужны название и хотя бы одна группа. При применении шаблона в событие
          попадут только ответившие «Приду».
        </DialogDescription>
        <BuilderBody
          initial={initial}
          initialPeople={initialPeople}
          onClose={onClose}
        />
      </DialogContent>
    </Dialog>
  )
}
