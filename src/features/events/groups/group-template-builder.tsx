import { useEffect, useState, type ReactNode } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { useForm, useStore } from '@tanstack/react-form'
import { EllipsisVertical, GripVertical, Plus, X } from 'lucide-react'
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Card } from '@/components/ui/surfaces'
import { cn } from '@/lib/utils'
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
      className={`grid w-full max-w-[19rem] grid-cols-5 gap-x-2 text-[10px] leading-tight text-muted-foreground ${className ?? ''}`}
    >
      {CHARACTER_STAT_FIELDS.map((field) => (
        <span key={field} className="min-w-0">
          <span className="sr-only">{CHARACTER_STAT_LABELS[field]}: </span>
          <strong className="font-medium text-foreground tabular-nums">
            {formatCharacterStat(field, person[field])}
          </strong>
        </span>
      ))}
    </span>
  )
}

function TemplatePersonDragOverlay({
  person,
  showStats,
}: {
  person: TemplateBuilderPerson
  showStats: boolean
}) {
  return (
    <div className="grid w-[min(23rem,calc(100vw-2rem))] grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-x-1.5 gap-y-1 rounded-lg border border-primary bg-surface-menu px-1.5 py-1 shadow-popover">
      <GripVertical
        size={16}
        aria-hidden="true"
        className="text-muted-foreground"
      />
      <ClassIcon
        classId={person.classId}
        className={person.className}
        wrapperClassName="size-6"
      />
      <span className="grid min-w-0">
        <strong className="break-words text-xs">{person.gameNickname}</strong>
        {showStats ? <StatValues person={person} /> : null}
      </span>
      <EllipsisVertical
        size={16}
        aria-hidden="true"
        className="text-muted-foreground"
      />
    </div>
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

function DragHandle({
  userId,
  nickname,
}: {
  userId: string
  nickname: string
}) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: `person:${userId}`,
  })
  return (
    <button
      ref={setNodeRef}
      type="button"
      className={cn(
        'grid size-6 flex-none cursor-grab touch-none place-items-center rounded-md border-0 bg-transparent text-muted-foreground hover:text-primary',
        isDragging && 'opacity-40',
      )}
      aria-label={`Перетащить ${nickname}`}
      {...listeners}
      {...attributes}
    >
      <GripVertical size={16} aria-hidden="true" />
    </button>
  )
}

function DropZone({
  id,
  className,
  children,
}: {
  id: string
  className?: string
  children: ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div
      ref={setNodeRef}
      className={cn(className, isOver && 'rounded-xl ring-2 ring-primary')}
    >
      {children}
    </div>
  )
}

function DropListItem({ id, children }: { id: string; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <li
      ref={setNodeRef}
      className={cn(
        'grid min-w-0 grid-cols-[minmax(0,1fr)] items-center gap-0 rounded-md border border-border bg-surface-inset px-1.5 py-1',
        isOver && 'border-primary bg-surface-inset',
      )}
    >
      {children}
    </li>
  )
}

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
  const [dragging, setDragging] = useState<{
    userId: string
    showStats: boolean
  } | null>(null)
  const [returnedIds, setReturnedIds] = useState<Set<string>>(() => new Set())
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 6 },
    }),
  )
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
  const normalizedSearch = debouncedSearch.trim().toLocaleLowerCase('ru-RU')
  const returned = initialPeople.filter(
    (member) =>
      returnedIds.has(member.id) &&
      (classId === null || member.classId === classId) &&
      (!normalizedSearch ||
        [member.gameNickname, member.className].some((value) =>
          value.toLocaleLowerCase('ru-RU').includes(normalizedSearch),
        )),
  )
  const available = [
    ...new Map(
      [...roster, ...returned].map((member) => [member.id, member]),
    ).values(),
  ]
  const free = available.filter((member) => !assigned.has(member.id))

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

  function moveMember(
    userId: string,
    targetGroup: number | null,
    before?: number,
  ) {
    const sourceGroup = groups.findIndex((group) =>
      group.members.some((member) => member.userId === userId),
    )
    const sourcePosition =
      sourceGroup < 0
        ? -1
        : groups[sourceGroup]!.members.findIndex(
            (member) => member.userId === userId,
          )
    if (
      targetGroup !== null &&
      sourceGroup !== targetGroup &&
      (groups[targetGroup]?.members.length ?? 0) >= GROUP_LIMITS.members
    ) {
      toast(`В группе может быть не больше ${GROUP_LIMITS.members} участников`)
      return
    }
    setReturnedIds((current) => {
      const next = new Set(current)
      if (targetGroup === null && sourceGroup >= 0) {
        next.add(userId)
      } else if (targetGroup !== null) {
        next.delete(userId)
      }
      return next
    })
    update((current) => {
      const moved =
        sourceGroup < 0
          ? { userId, isLeader: false }
          : current[sourceGroup]!.members[sourcePosition]!
      const next = current.map((group) => ({
        ...group,
        members: group.members.filter((member) => member.userId !== userId),
      }))
      if (targetGroup === null) {
        return next
      }
      const target = next[targetGroup]!
      let position = before ?? target.members.length
      if (sourceGroup === targetGroup && sourcePosition < position) {
        position -= 1
      }
      position = Math.max(0, Math.min(position, target.members.length))
      target.members.splice(position, 0, {
        userId,
        isLeader: sourceGroup === targetGroup && moved.isLeader,
      })
      return next
    })
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    setDragging(null)
    if (!over) {
      return
    }
    const userId = String(active.id).replace('person:', '')
    const [kind, target, slot] = String(over.id).split(':')
    if (kind === 'pool') {
      moveMember(userId, null)
    } else if (kind === 'group') {
      moveMember(userId, Number(target))
    } else if (kind === 'slot') {
      moveMember(userId, Number(target), Number(slot))
    }
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
    <DndContext
      sensors={sensors}
      accessibility={{
        screenReaderInstructions: {
          draggable:
            'Перетаскивайте участника за маркер в группу или обратно в список.',
        },
      }}
      onDragStart={({ active }) => {
        const userId = String(active.id).replace('person:', '')
        setDragging({
          userId,
          showStats: !groups.some((group) =>
            group.members.some((member) => member.userId === userId),
          ),
        })
      }}
      onDragCancel={() => setDragging(null)}
      onDragEnd={onDragEnd}
    >
      <form
        noValidate
        aria-label="Конструктор шаблона групп"
        className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          void form.handleSubmit()
        }}
      >
        <div className="grid min-h-0 content-start gap-4 overflow-y-auto">
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
                        className="w-full max-w-sm"
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
                <div className="grid min-w-0 items-start gap-3 lg:h-[calc(100dvh-17rem)] lg:min-h-0 lg:grid-cols-[minmax(18rem,23rem)_minmax(0,1fr)]">
                  <section
                    aria-label="Группы шаблона"
                    className="order-2 grid min-w-0 content-start gap-2 lg:order-2 lg:h-full lg:min-h-0 lg:content-start"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="m-0 font-sans text-base font-bold text-foreground">
                        Группы
                      </h3>
                      <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground tabular-nums">
                        {groups.length}
                      </span>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={groups.length >= GROUP_LIMITS.groups}
                        onClick={() =>
                          update((current) => [
                            ...current,
                            { name: `Пати ${current.length + 1}`, members: [] },
                          ])
                        }
                      >
                        <Plus size={14} aria-hidden="true" /> Создать группу
                      </Button>
                    </div>
                    <div className="grid content-start min-w-0 grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))] gap-2 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:pr-1">
                      {groups.map((group, groupIndex) => (
                        <DropZone
                          // Группы шаблона не имеют id: порядок задаёт пользователь.
                          // oxlint-disable-next-line react/no-array-index-key
                          key={groupIndex}
                          id={`group:${groupIndex}`}
                          className="min-w-0"
                        >
                          <Card className="grid content-start gap-2 p-2">
                            <div className="flex min-w-0 items-center gap-2">
                              <h4 className="m-0 flex-none font-sans text-sm font-bold text-foreground tabular-nums">
                                {groupIndex + 1}
                              </h4>
                              <form.Field name={`groups[${groupIndex}].name`}>
                                {(field) => {
                                  const id = `template-group-${groupIndex}`
                                  const error = fieldError(
                                    field.state.meta,
                                    submitted,
                                  )
                                  return (
                                    <FormField
                                      id={id}
                                      label={
                                        <span className="sr-only">
                                          Название группы {groupIndex + 1}
                                        </span>
                                      }
                                      error={error}
                                      className="min-w-0 flex-1"
                                    >
                                      <Input
                                        {...fieldAria(id, error)}
                                        maxLength={GROUP_LIMITS.name}
                                        value={field.state.value}
                                        onChange={(change) =>
                                          field.handleChange(
                                            change.target.value,
                                          )
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
                                className="size-6 flex-none"
                                aria-label={`Удалить группу ${groupIndex + 1}`}
                                onClick={() =>
                                  update((current) =>
                                    current.filter(
                                      (_, index) => index !== groupIndex,
                                    ),
                                  )
                                }
                              >
                                <X size={16} aria-hidden="true" />
                              </Button>
                            </div>
                            <Select
                              aria-label={`Лидер группы «${group.name || `Группа ${groupIndex + 1}`}»`}
                              className="h-7 min-h-7 rounded-md px-2 py-1 text-xs [&_svg]:size-3"
                              value={
                                group.members.find((member) => member.isLeader)
                                  ?.userId ?? 'none'
                              }
                              onValueChange={(userId) =>
                                update((current) =>
                                  current.map((item, index) =>
                                    index === groupIndex
                                      ? {
                                          ...item,
                                          members: item.members.map(
                                            (member) => ({
                                              ...member,
                                              isLeader:
                                                userId !== 'none' &&
                                                member.userId === userId,
                                            }),
                                          ),
                                        }
                                      : item,
                                  ),
                                )
                              }
                              options={[
                                { value: 'none', label: 'Без лидера' },
                                ...group.members.map((member) => ({
                                  value: member.userId,
                                  label:
                                    people.get(member.userId)?.gameNickname ??
                                    'Выбыл из состава',
                                })),
                              ]}
                            />
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
                                    <DropListItem
                                      key={member.userId}
                                      id={`slot:${groupIndex}:${index}`}
                                    >
                                      <div className="col-span-full flex min-w-0 items-center gap-1">
                                        <DragHandle
                                          userId={member.userId}
                                          nickname={name}
                                        />
                                        <span className="w-6 flex-none text-xs font-bold text-primary tabular-nums">
                                          {index + 1}.
                                        </span>
                                        {person ? (
                                          <ClassIcon
                                            classId={person.classId}
                                            className={person.className}
                                            wrapperClassName="size-5"
                                          />
                                        ) : null}
                                        <span className="min-w-0 flex-1 text-xs break-words">
                                          {name}
                                          {member.isLeader ? (
                                            <span className="text-primary">
                                              {' '}
                                              <span title="Пати лидер">
                                                — ПЛ
                                              </span>
                                              <span className="sr-only">
                                                , пати лидер
                                              </span>
                                            </span>
                                          ) : null}
                                        </span>
                                        <DropdownMenu>
                                          <DropdownMenuTrigger asChild>
                                            <Button
                                              type="button"
                                              variant="ghost"
                                              size="icon"
                                              className="size-6 flex-none"
                                              aria-label={`Действия: ${name}`}
                                            >
                                              <EllipsisVertical
                                                size={16}
                                                aria-hidden="true"
                                              />
                                            </Button>
                                          </DropdownMenuTrigger>
                                          <DropdownMenuContent align="end">
                                            {groups.some(
                                              (_, index) =>
                                                index !== groupIndex,
                                            ) ? (
                                              <>
                                                <DropdownMenuLabel>
                                                  В группу
                                                </DropdownMenuLabel>
                                                {groups.map(
                                                  (target, targetIndex) =>
                                                    targetIndex ===
                                                    groupIndex ? null : (
                                                      <DropdownMenuItem
                                                        key={targetIndex}
                                                        disabled={
                                                          target.members
                                                            .length >=
                                                          GROUP_LIMITS.members
                                                        }
                                                        onSelect={() =>
                                                          moveMember(
                                                            member.userId,
                                                            targetIndex,
                                                          )
                                                        }
                                                      >
                                                        {target.name ||
                                                          `Группа ${targetIndex + 1}`}
                                                      </DropdownMenuItem>
                                                    ),
                                                )}
                                                <DropdownMenuSeparator />
                                              </>
                                            ) : null}
                                            <DropdownMenuItem
                                              disabled={index === 0}
                                              onSelect={() =>
                                                moveWithin(
                                                  groupIndex,
                                                  index,
                                                  index - 1,
                                                )
                                              }
                                            >
                                              Выше
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                              disabled={
                                                index ===
                                                group.members.length - 1
                                              }
                                              onSelect={() =>
                                                moveWithin(
                                                  groupIndex,
                                                  index,
                                                  index + 1,
                                                )
                                              }
                                            >
                                              Ниже
                                            </DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem
                                              onSelect={() =>
                                                moveMember(member.userId, null)
                                              }
                                            >
                                              Вернуть в список
                                            </DropdownMenuItem>
                                          </DropdownMenuContent>
                                        </DropdownMenu>
                                      </div>
                                    </DropListItem>
                                  )
                                })}
                              </ol>
                            )}
                          </Card>
                        </DropZone>
                      ))}
                    </div>
                  </section>
                  <DropZone
                    id="pool"
                    className="order-1 min-w-0 lg:order-1 lg:h-full lg:min-h-0"
                  >
                    <section
                      aria-label="Состав клана"
                      className="h-full min-w-0"
                    >
                      <Card className="grid min-w-0 content-start gap-2 p-3 lg:h-full lg:min-h-0 lg:grid-rows-[auto_auto_auto_auto_minmax(0,1fr)] lg:overflow-hidden">
                        <h3 className="m-0 font-sans text-base font-bold text-foreground">
                          Участники
                        </h3>
                        <p className="m-0 text-xs text-muted-foreground">
                          Назначенные в группу участники скрываются из списка.
                        </p>
                        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem]">
                          <Input
                            type="search"
                            aria-label="Поиск в составе"
                            placeholder="Поиск по нику или классу"
                            value={search}
                            onChange={(change) =>
                              setSearch(change.target.value)
                            }
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
                          <ErrorState
                            onRetry={() => void rosterQuery.refetch()}
                          />
                        ) : free.length === 0 && !rosterQuery.hasNextPage ? (
                          <p className="m-0 text-sm text-muted-foreground">
                            Никого нет.
                          </p>
                        ) : (
                          <>
                            <div className="flex items-end gap-2 px-1 py-0.5">
                              <span
                                aria-hidden="true"
                                className="size-6 flex-none"
                              />
                              <span
                                aria-hidden="true"
                                className="size-6 flex-none"
                              />
                              <div className="grid w-full max-w-[19rem] flex-1 grid-cols-5 gap-x-2 text-[10px] leading-tight text-muted-foreground">
                                {CHARACTER_STAT_FIELDS.map((field) => (
                                  <span key={field}>
                                    {CHARACTER_STAT_LABELS[field]}
                                  </span>
                                ))}
                              </div>
                              <span
                                aria-hidden="true"
                                className="size-8 flex-none"
                              />
                            </div>
                            <ScrollableVirtualList
                              items={free}
                              getKey={(member) => member.id}
                              label="Свободные участники"
                              estimateSize={48}
                              endPadding={48}
                              viewportRows={7}
                              viewportHeight="calc(100dvh - 25rem)"
                              showLoadMore={false}
                              paging={pagingOf(rosterQuery)}
                              renderItem={(member) => (
                                <div className="flex min-w-0 items-center gap-1.5 rounded-lg border border-border bg-surface-inset px-1.5 py-1">
                                  <DragHandle
                                    userId={member.id}
                                    nickname={member.gameNickname}
                                  />
                                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                                    <ClassIcon
                                      classId={member.classId}
                                      className={member.className}
                                      wrapperClassName="size-6"
                                    />
                                    <span className="grid min-w-0 flex-1">
                                      <strong className="break-words text-xs">
                                        {member.gameNickname}
                                      </strong>
                                      <StatValues person={member} />
                                    </span>
                                  </div>
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="size-8 flex-none"
                                        aria-label={`Действия: ${member.gameNickname}`}
                                      >
                                        <EllipsisVertical
                                          size={16}
                                          aria-hidden="true"
                                        />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      {groups.length === 0 ? (
                                        <DropdownMenuLabel>
                                          Сначала создайте группу
                                        </DropdownMenuLabel>
                                      ) : (
                                        <DropdownMenuLabel>
                                          В группу
                                        </DropdownMenuLabel>
                                      )}
                                      {groups.map((group, index) => {
                                        const full =
                                          group.members.length >=
                                          GROUP_LIMITS.members
                                        return (
                                          <DropdownMenuItem
                                            // oxlint-disable-next-line react/no-array-index-key
                                            key={index}
                                            disabled={full}
                                            onSelect={() =>
                                              moveMember(member.id, index)
                                            }
                                          >
                                            {group.name ||
                                              `Группа ${index + 1}`}
                                            {full ? ' · максимум 50' : ''}
                                          </DropdownMenuItem>
                                        )
                                      })}
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                              )}
                            />
                          </>
                        )}
                      </Card>
                    </section>
                  </DropZone>
                </div>
              </>
            )}
          </form.Subscribe>
        </div>
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
      <DragOverlay>
        {dragging && people.get(dragging.userId) ? (
          <TemplatePersonDragOverlay
            person={people.get(dragging.userId)!}
            showStats={dragging.showStats}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
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
      <DialogContent className="grid h-dvh w-screen max-h-dvh max-w-none grid-rows-[auto_auto_minmax(0,1fr)] gap-3 overflow-hidden rounded-none p-4 sm:p-6">
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
