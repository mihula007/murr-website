import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  ArrowDown,
  ArrowUp,
  Copy,
  EllipsisVertical,
  GripVertical,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { type EventDetails, type EventParticipant } from '@contracts/events'
import {
  CHARACTER_STAT_FIELDS,
  CHARACTER_STAT_LABELS,
  type CharacterStatNumberField,
} from '@contracts/character-stats'
import type { EventGroup } from '@contracts/groups'
import { ConfirmActionDialog } from '@/components/confirm-action-dialog'
import { useAccess } from '@/app/access'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
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
import { Select } from '@/components/ui/select'
import { Card } from '@/components/ui/surfaces'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { toast } from '@/components/ui/toaster'
import { useSession } from '@/features/auth/session'
import { ClassIcon } from '@/features/catalog/class-icon'
import { ScrollableVirtualList, pagingOf } from '@/components/virtual-list'
import { useClasses } from '@/features/catalog/use-classes'
import { formatCharacterStat } from '@/features/roster/character-stats'
import { errorMessage, fieldMessage, type AppError } from '@/lib/errors'
import { cn } from '@/lib/utils'
import {
  useCloseEvent,
  useCreateGroup,
  useDeleteGroup,
  useMoveMember,
  useRenameGroup,
  useSetGroupLeader,
} from '../groups-api'
import { useGroupPoolPages } from '../api'
import { PrepareBroadcastLink } from '@/features/broadcast/prepare-broadcast-link'
import { GroupNameDialog } from './group-name-dialog'
import { GroupTemplatesDialog } from './group-templates-dialog'

const sectionTitleClass = 'm-0 font-sans text-base font-bold text-foreground'

/** Ошибка операции с группами — уведомлением; конфликт — с подсказкой. */
function reportError(error: unknown) {
  const appError = error as AppError
  const field = Object.values(appError.fields ?? {})[0]
  if (appError.code === 'state_conflict') {
    toast('Событие уже закрыто: группы больше не меняются')
    return
  }
  toast(field ? fieldMessage(field) : errorMessage(appError.code))
}

/** Цель переноса: группа (позиция — индекс после снятия) или пул. */
type Target = { groupId: string | null; position: number | null }

type Board = {
  event: EventDetails
  people: Map<string, EventParticipant>
  currentUserId: string | undefined
  editable: boolean
  move: (userId: string, target: Target) => void
}

/** Индекс в целевой группе после снятия человека с прежнего места. */
export function finalPosition(
  groups: EventGroup[],
  userId: string,
  groupId: string,
  before: number,
) {
  const group = groups.find((item) => item.id === groupId)
  const current = group?.members.findIndex((m) => m.userId === userId) ?? -1
  return current !== -1 && current < before ? before - 1 : before
}

type PersonRowProps = {
  board: Board
  person: EventParticipant
  virtual?: boolean
  /** Группа и номер строки; нет — строка свободного списка. */
  group?: EventGroup
  index?: number
  isLeader?: boolean
}

/** Строка участника: перетаскивание за маркер и меню переноса (GRP-04, GRP-07). */
function PersonRow({
  board,
  person,
  group,
  index,
  isLeader,
  virtual = false,
}: PersonRowProps) {
  const [statsOpen, setStatsOpen] = useState(false)
  const [statsHoverOpen, setStatsHoverOpen] = useState(false)
  const {
    setNodeRef: dragRef,
    listeners,
    attributes,
    isDragging,
  } = useDraggable({
    id: `person:${person.id}`,
    disabled: !board.editable,
  })
  const { setNodeRef: dropRef, isOver } = useDroppable({
    id: group ? `slot:${group.id}:${index}` : `pool-row:${person.id}`,
    disabled: !board.editable || !group,
  })
  const others = board.editable
    ? board.event.groups.filter((item) => item.id !== group?.id)
    : []
  const size = group?.members.length ?? 0
  const Row = virtual ? 'div' : 'li'

  const row = (
    <Row
      ref={dropRef}
      onMouseEnter={
        group && board.event.closedAt === null
          ? () => setStatsHoverOpen(true)
          : undefined
      }
      onMouseLeave={
        group && board.event.closedAt === null
          ? () => setStatsHoverOpen(false)
          : undefined
      }
      className={cn(
        'relative flex min-w-0 items-center border border-border bg-surface-inset',
        group ? 'gap-1.5 rounded-md px-1.5 py-1' : 'gap-2 rounded-lg px-2 py-1',
        person.id === board.currentUserId && 'bg-item-highlight!',
        isDragging && 'opacity-40',
        isOver && 'border-primary',
      )}
    >
      {board.editable ? (
        <button
          ref={dragRef}
          type="button"
          className={cn(
            'grid flex-none cursor-grab touch-none place-items-center rounded-md border-0 bg-transparent text-muted-foreground hover:text-primary',
            group ? 'size-6' : 'size-7',
          )}
          aria-label={`Перетащить ${person.gameNickname}`}
          {...listeners}
          {...attributes}
        >
          <GripVertical size={16} aria-hidden="true" />
        </button>
      ) : null}
      {index !== undefined ? (
        <span className="w-6 flex-none text-sm font-bold text-primary tabular-nums">
          {index + 1}.
        </span>
      ) : null}
      <ClassIcon
        classId={person.classId}
        className={person.className}
        wrapperClassName={group ? 'size-5' : 'size-6'}
      />
      <span className="grid min-w-0 flex-1">
        <strong className={cn('break-words', group ? 'text-xs' : 'text-sm')}>
          {person.gameNickname}
          {isLeader ? (
            <span className="font-normal text-primary" title="Пати лидер">
              <span aria-hidden="true"> — ПЛ</span>
              <span className="sr-only">, пати лидер</span>
            </span>
          ) : null}
        </strong>
        {/* У закрытого события снимок посещения без характеристик (GRP-01). */}
        {!group && board.event.closedAt === null ? (
          <span className="grid grid-cols-5 gap-x-2 pt-1 text-[10px] leading-tight text-muted-foreground sm:max-w-[19rem]">
            {CHARACTER_STAT_FIELDS.map((field) => (
              <span key={field} className="min-w-0">
                <span className="sr-only">
                  {CHARACTER_STAT_LABELS[field]}:{' '}
                </span>
                <strong className="font-medium text-foreground tabular-nums">
                  {formatCharacterStat(field, person[field])}
                </strong>
              </span>
            ))}
          </span>
        ) : null}
      </span>
      {board.editable || (group && board.event.closedAt === null) ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn('flex-none', group ? 'size-6' : 'size-8')}
              aria-label={`Действия: ${person.gameNickname}`}
              onMouseEnter={() => setStatsHoverOpen(false)}
              onFocus={() => setStatsHoverOpen(false)}
            >
              <EllipsisVertical size={16} aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {group && board.event.closedAt === null ? (
              <DropdownMenuItem onSelect={() => setStatsOpen(true)}>
                Характеристики
              </DropdownMenuItem>
            ) : null}
            {group && board.editable ? <DropdownMenuSeparator /> : null}
            {others.length > 0 ? (
              <DropdownMenuLabel>В группу</DropdownMenuLabel>
            ) : null}
            {others.map((item) => (
              <DropdownMenuItem
                key={item.id}
                onSelect={() =>
                  board.move(person.id, { groupId: item.id, position: null })
                }
              >
                {item.name}
              </DropdownMenuItem>
            ))}
            {others.length === 0 && !group ? (
              <DropdownMenuLabel>Сначала создайте группу</DropdownMenuLabel>
            ) : null}
            {group && index !== undefined && board.editable ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={index === 0}
                  onSelect={() =>
                    board.move(person.id, {
                      groupId: group.id,
                      position: index - 1,
                    })
                  }
                >
                  Выше
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={index === size - 1}
                  onSelect={() =>
                    board.move(person.id, {
                      groupId: group.id,
                      position: index + 1,
                    })
                  }
                >
                  Ниже
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() =>
                    board.move(person.id, { groupId: null, position: null })
                  }
                >
                  Вернуть в список
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <Dialog open={statsOpen} onOpenChange={setStatsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Характеристики: {person.gameNickname}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-5 gap-2 text-sm">
            {CHARACTER_STAT_FIELDS.map((field) => (
              <div key={field} className="grid">
                <span className="text-muted-foreground">
                  {CHARACTER_STAT_LABELS[field]}
                </span>
                <strong>
                  {formatCharacterStat(field, person[field]) ?? '—'}
                </strong>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </Row>
  )

  return group && board.event.closedAt === null ? (
    <Popover open={statsHoverOpen} onOpenChange={setStatsHoverOpen}>
      <PopoverAnchor asChild>{row}</PopoverAnchor>
      <PopoverContent
        role="tooltip"
        side="bottom"
        align="center"
        sideOffset={4}
        className="pointer-events-none w-[min(20rem,calc(100vw-2rem))] p-2"
      >
        <span className="grid grid-cols-5 gap-2 text-xs">
          {CHARACTER_STAT_FIELDS.map((field) => (
            <span key={field} className="grid">
              <span className="text-muted-foreground">
                {CHARACTER_STAT_LABELS[field]}
              </span>
              <strong>
                {formatCharacterStat(field, person[field]) ?? '—'}
              </strong>
            </span>
          ))}
        </span>
      </PopoverContent>
    </Popover>
  ) : (
    row
  )
}

type PoolTab = {
  value: string
  label: string
  test: (p: EventParticipant) => boolean
}

const ANSWER_TABS: PoolTab[] = [
  { value: 'yes', label: 'Придут', test: (p) => p.answer === 'yes' },
  { value: 'no', label: 'Не придут', test: (p) => p.answer === 'no' },
  { value: 'maybe', label: '50/50', test: (p) => p.answer === 'maybe' },
  { value: 'none', label: 'Не отметились', test: (p) => p.answer === null },
]

const STATUS_TABS: PoolTab[] = [
  { value: 'visited', label: 'Посетили', test: (p) => p.status === 'visited' },
  { value: 'missed', label: 'Не посетили', test: (p) => p.status === 'missed' },
  {
    value: 'unmarked',
    label: 'Не отметились',
    test: (p) => p.status === 'unmarked',
  },
]

/**
 * Свободные участники по ответам с поиском (GRP-01, GRP-02); назначенные в
 * группы скрыты. У закрытого события — итог посещения по всем участникам.
 */
function PoolPanel({
  board,
  classIds,
  onClassIdsChange,
}: {
  board: Board
  classIds: number[]
  onClassIdsChange: (ids: number[]) => void
}) {
  const closed = board.event.closedAt !== null
  const { hasOfficerPermission } = useAccess()
  const canViewAll = hasOfficerPermission('events.view_full_roster')
  const tabs = closed ? STATUS_TABS : ANSWER_TABS
  const [tab, setTab] = useState(tabs[0]!.value)
  const [statSort, setStatSort] = useState<{
    field: CharacterStatNumberField
    direction: 'asc' | 'desc'
  } | null>(null)
  const { setNodeRef: dropRef, isOver } = useDroppable({
    id: 'pool',
    disabled: !board.editable,
  })
  const poolQuery = useGroupPoolPages({
    eventId: board.event.id,
    tab: tab as 'yes' | 'no' | 'maybe' | 'none',
    classIds,
    sortBy: statSort?.field ?? null,
    direction: statSort?.direction ?? 'desc',
    enabled: !closed && canViewAll,
  })
  const classes = useClasses()
  const assigned = new Set(
    board.event.groups.flatMap((group) => group.members.map((m) => m.userId)),
  )
  const free = closed
    ? board.event.participants
    : board.event.participants.filter((person) => !assigned.has(person.id))
  const current = tabs.find((item) => item.value === tab) ?? tabs[0]!
  const filtered = closed
    ? free.filter(current.test)
    : (poolQuery.data?.pages.flatMap((page) => page.items) ?? [])
  const shown =
    closed && statSort
      ? [...filtered].sort((left, right) => {
          const leftValue = left[statSort.field]
          const rightValue = right[statSort.field]
          if (leftValue == null && rightValue == null) {
            return left.gameNickname.localeCompare(right.gameNickname, 'ru-RU')
          }
          if (leftValue == null) {
            return 1
          }
          if (rightValue == null) {
            return -1
          }
          const difference =
            (Number(leftValue) - Number(rightValue)) *
            (statSort.direction === 'asc' ? 1 : -1)
          return (
            difference ||
            left.gameNickname.localeCompare(right.gameNickname, 'ru-RU')
          )
        })
      : filtered

  function toggleStatSort(field: CharacterStatNumberField) {
    setStatSort((currentSort) =>
      currentSort?.field === field
        ? {
            field,
            direction: currentSort.direction === 'desc' ? 'asc' : 'desc',
          }
        : { field, direction: 'desc' },
    )
  }

  return (
    <Card
      ref={dropRef}
      className={cn(
        'grid content-start gap-1.5 p-2.5 lg:sticky lg:top-4 lg:flex lg:h-[calc(100svh-2rem)] lg:flex-col lg:overflow-hidden',
        isOver && 'border-primary',
      )}
    >
      {closed ? (
        <h2 className={cn(sectionTitleClass, 'lg:flex-none')}>
          Итог посещения
        </h2>
      ) : null}
      <Tabs
        value={current.value}
        onValueChange={setTab}
        className="lg:flex-none"
      >
        <TabsList
          aria-label={closed ? 'Итог посещения' : 'Ответы участников'}
          className="grid grid-cols-2 overflow-visible"
        >
          {tabs.map((item) => (
            <TabsTrigger
              key={item.value}
              value={item.value}
              className="inline-flex items-center justify-center gap-1.5"
            >
              {item.label}
              <span className="text-xs text-muted-foreground tabular-nums">
                {closed
                  ? free.filter(item.test).length
                  : (poolQuery.data?.pages[0]?.counts[
                      item.value as 'yes' | 'no' | 'maybe' | 'none'
                    ] ?? 0)}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {!closed ? (
        <ul
          aria-label="Фильтр по классам"
          className="m-0 flex list-none flex-wrap gap-0.5 p-0 lg:flex-none"
        >
          {(classes.data ?? []).map((item) => {
            const active = classIds.includes(item.id)
            return (
              <li key={item.id}>
                <button
                  type="button"
                  aria-label={`Фильтр по классу ${item.name}`}
                  aria-pressed={active}
                  title={item.name}
                  onClick={() =>
                    onClassIdsChange(
                      active
                        ? classIds.filter((id) => id !== item.id)
                        : [...classIds, item.id].sort((a, b) => a - b),
                    )
                  }
                  className={cn(
                    'rounded-full border border-border p-0.5 hover:border-primary',
                    active && 'border-highlight bg-highlight',
                  )}
                >
                  <ClassIcon
                    classId={item.id}
                    className={item.name}
                    wrapperClassName="size-6"
                  />
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
      <div className="min-h-0 lg:flex-1 lg:overflow-y-auto">
        {!closed && poolQuery.isPending ? (
          <p className="m-0 text-muted-foreground">Загружаем участников…</p>
        ) : shown.length === 0 ? (
          <p className="m-0 text-muted-foreground">Никого нет.</p>
        ) : (
          <>
            {closed ? null : (
              <div className="flex items-end gap-2 px-2 py-1 lg:sticky lg:top-0 lg:z-10 lg:bg-surface-from">
                {board.editable ? (
                  <span aria-hidden="true" className="w-7" />
                ) : null}
                <span aria-hidden="true" className="size-6 flex-none" />
                <div className="grid max-w-[19rem] flex-1 grid-cols-5 gap-x-2">
                  {CHARACTER_STAT_FIELDS.map((field) => {
                    const activeSort =
                      statSort?.field === field ? statSort : null
                    const label = CHARACTER_STAT_LABELS[field]
                    return (
                      <button
                        key={field}
                        type="button"
                        aria-label={
                          activeSort
                            ? `${label}, сортировка ${activeSort.direction === 'desc' ? 'по убыванию' : 'по возрастанию'}`
                            : `Сортировать по ${label}`
                        }
                        aria-pressed={activeSort !== null}
                        title={`Сортировать по ${label}`}
                        className="inline-flex min-w-0 cursor-pointer items-center gap-0.5 border-0 bg-transparent p-0 text-left text-[10px] leading-tight text-muted-foreground hover:text-primary"
                        onClick={() => toggleStatSort(field)}
                      >
                        {label}
                        {activeSort ? (
                          activeSort.direction === 'desc' ? (
                            <ArrowDown size={10} aria-hidden="true" />
                          ) : (
                            <ArrowUp size={10} aria-hidden="true" />
                          )
                        ) : null}
                      </button>
                    )
                  })}
                </div>
                {board.editable ? (
                  <span aria-hidden="true" className="w-8" />
                ) : null}
              </div>
            )}
            {closed ? (
              <ul
                aria-label={current.label}
                className="m-0 grid list-none gap-1.5 p-0"
              >
                {shown.map((person) => (
                  <PersonRow key={person.id} board={board} person={person} />
                ))}
              </ul>
            ) : (
              <ScrollableVirtualList
                items={shown}
                getKey={(person) => person.id}
                renderItem={(person) => (
                  <PersonRow board={board} person={person} virtual />
                )}
                label={current.label}
                estimateSize={52}
                viewportRows={8}
                paging={pagingOf(poolQuery)}
                gridClassName="grid-cols-1"
              />
            )}
          </>
        )}
        {!closed && poolQuery.isError ? (
          <p className="text-sm text-destructive">
            Не удалось загрузить список.
          </p>
        ) : null}
      </div>
    </Card>
  )
}

const NO_LEADER = 'none'

/** Группа: состав по порядку, лидер, переименование, ники, удаление (GRP-03–10). */
function GroupCard({ board, group }: { board: Board; group: EventGroup }) {
  const eventId = board.event.id
  const { setNodeRef: dropRef, isOver } = useDroppable({
    id: `group:${group.id}`,
    disabled: !board.editable,
  })
  const rename = useRenameGroup()
  const remove = useDeleteGroup()
  const setLeader = useSetGroupLeader()
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const members = group.members.flatMap((member) => {
    const person = board.people.get(member.userId)
    return person ? [{ ...member, person }] : []
  })
  const leader = group.members.find((member) => member.isLeader)

  async function copyNicks() {
    if (members.length === 0) {
      toast('В группе никого нет: копировать нечего')
      return
    }
    try {
      await navigator.clipboard.writeText(
        members.map((member) => member.person.gameNickname).join(', '),
      )
      toast('Ники скопированы')
    } catch {
      toast('Не удалось скопировать ники')
    }
  }

  return (
    <Card
      ref={dropRef}
      className={cn('grid content-start gap-2 p-2', isOver && 'border-primary')}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <h3 className="m-0 min-w-0 flex-1 font-sans text-sm font-bold break-words">
          {group.name}{' '}
          <span className="text-muted-foreground tabular-nums">
            · {group.members.length}
          </span>
        </h3>
        {board.editable ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={`Переименовать «${group.name}»`}
            onClick={() => setRenaming(true)}
          >
            <Pencil size={14} aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      {board.editable ? (
        <div className="grid gap-1.5">
          <Select
            aria-label={`Лидер группы «${group.name}»`}
            className="h-7 min-h-7 rounded-md px-2 py-1 text-xs [&_svg]:size-3"
            value={leader?.userId ?? NO_LEADER}
            onValueChange={(value) =>
              void setLeader
                .mutateAsync({
                  eventId,
                  input: {
                    groupId: group.id,
                    userId: value === NO_LEADER ? null : value,
                  },
                })
                .catch(reportError)
            }
            options={[
              { value: NO_LEADER, label: 'Без лидера' },
              ...members.map((member) => ({
                value: member.userId,
                label: member.person.gameNickname,
              })),
            ]}
          />
          <div className="flex flex-nowrap items-center gap-1">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-6 flex-none gap-0.5 whitespace-nowrap rounded-md px-1 py-1 text-[9px] leading-none"
              onClick={() => void copyNicks()}
            >
              <Copy size={12} aria-hidden="true" /> Скопировать ники
            </Button>
            {members.length > 0 ? (
              <PrepareBroadcastLink
                source="group"
                id={group.id}
                label="Рассылка"
                className="h-6 flex-none gap-0.5 whitespace-nowrap rounded-md px-1 py-1 text-[9px] leading-none"
              />
            ) : null}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-6 flex-none gap-0.5 whitespace-nowrap rounded-md px-1 py-1 text-[9px] leading-none text-destructive"
              onClick={() => setDeleting(true)}
            >
              <Trash2 size={12} aria-hidden="true" /> Удалить
            </Button>
          </div>
        </div>
      ) : null}
      {members.length === 0 ? (
        <p className="m-0 rounded-md border border-dashed border-border p-2 text-center text-xs text-muted-foreground">
          {board.editable
            ? 'Перетащите участников сюда или выберите группу в меню «⋮».'
            : 'В группе никого нет.'}
        </p>
      ) : (
        <ol
          aria-label={`Состав «${group.name}»`}
          className="m-0 grid list-none gap-1 p-0"
        >
          {members.map((member, index) => (
            <PersonRow
              key={member.userId}
              board={board}
              person={member.person}
              group={group}
              index={index}
              isLeader={member.isLeader}
            />
          ))}
        </ol>
      )}
      <GroupNameDialog
        open={renaming}
        onOpenChange={setRenaming}
        title="Переименовать группу"
        description="Состав, порядок и лидер не изменятся."
        submitLabel="Сохранить"
        initialName={group.name}
        onSubmit={async (name) => {
          await rename.mutateAsync({
            eventId,
            input: { groupId: group.id, name },
          })
          toast('Группа переименована')
        }}
      />
      <ConfirmActionDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Удалить группу «${group.name}»?`}
        description="Участники вернутся в список; их ответы и аккаунты не изменятся."
        confirmLabel="Удалить"
        pendingLabel="Удаляем…"
        onConfirm={async () => {
          await remove.mutateAsync({ eventId, input: { groupId: group.id } })
          toast('Группа удалена')
        }}
      />
    </Card>
  )
}

/** Завершение события рядом с заголовком списка групп. */
function EventToolbar({
  board,
  className,
}: {
  board: Board
  className?: string
}) {
  const { event } = board
  const close = useCloseEvent()
  const [closing, setClosing] = useState(false)
  const hasGroups = event.groups.length > 0

  return (
    <div className={cn('flex justify-end', className)}>
      {event.canClose ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => setClosing(true)}
        >
          Завершить событие
        </Button>
      ) : null}
      <ConfirmActionDialog
        open={closing}
        onOpenChange={setClosing}
        title={`Завершить «${event.title}»?`}
        description={
          <>
            Итог фиксируется один раз: в группе — «Посетил», вне группы с
            ответом — «Не посетил», без ответа — «Не отметился». Закрытое
            событие нельзя открыть снова, группы и ответы больше не меняются.
            {hasGroups ? null : (
              <strong className="mt-2 block text-foreground">
                Групп нет: никто не получит «Посетил».
              </strong>
            )}
          </>
        }
        confirmLabel="Завершить"
        pendingLabel="Завершаем…"
        onConfirm={async () => {
          await close.mutateAsync(event.id)
          toast('Событие завершено, итог сохранён')
        }}
      />
    </div>
  )
}

/** Кнопки создания и шаблонов размещены в заголовке доски групп. */
function GroupToolbar({ board }: { board: Board }) {
  const { event } = board
  const create = useCreateGroup()
  const [creating, setCreating] = useState(false)
  const [templates, setTemplates] = useState(false)

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button size="sm" type="button" onClick={() => setCreating(true)}>
        <Plus size={14} aria-hidden="true" /> Создать группу
      </Button>
      <Button
        size="sm"
        type="button"
        variant="secondary"
        onClick={() => setTemplates(true)}
      >
        Шаблоны групп
      </Button>
      <GroupNameDialog
        open={creating}
        onOpenChange={setCreating}
        title="Новая группа"
        description="Группа появится в конце списка; участников добавьте перетаскиванием или через меню."
        submitLabel="Создать"
        onSubmit={async (name) => {
          await create.mutateAsync({
            eventId: event.id,
            input: { eventId: event.id, name },
          })
          toast('Группа создана')
        }}
      />
      <GroupTemplatesDialog
        open={templates}
        onOpenChange={setTemplates}
        event={event}
      />
    </div>
  )
}

/** Название цели переноса для объявлений экранного диктора. */
function targetName(event: EventDetails, id: string | number | undefined) {
  const [kind, groupId] = String(id ?? '').split(':')
  if (kind === 'pool' || kind === 'pool-row') {
    return 'список участников'
  }
  const group = event.groups.find((item) => item.id === groupId)
  return group ? `группу «${group.name}»` : 'пустое место'
}

/** Объявления dnd-kit по-русски: ник и группа вместо служебных id. */
function announcements(
  event: EventDetails,
  people: Map<string, EventParticipant>,
): Announcements {
  const nick = (id: string | number) =>
    people.get(String(id).replace('person:', ''))?.gameNickname ?? 'Участник'
  return {
    onDragStart: ({ active }) => `${nick(active.id)}: перенос начат`,
    onDragOver: ({ active, over }) =>
      over
        ? `${nick(active.id)} над: ${targetName(event, over.id)}`
        : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? `${nick(active.id)} перенесён в ${targetName(event, over.id)}`
        : `${nick(active.id)}: перенос отменён`,
    onDragCancel: ({ active }) => `${nick(active.id)}: перенос отменён`,
  }
}

/** Строка под курсором при перетаскивании. */
function DragPreview({
  person,
}: {
  person: EventParticipant | undefined
}): ReactNode {
  if (!person) {
    return null
  }
  return (
    <div className="grid w-[min(23rem,calc(100vw-2rem))] grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1 rounded-lg border border-primary bg-surface-menu px-2 py-1.5 shadow-popover">
      <GripVertical
        size={14}
        aria-hidden="true"
        className="text-muted-foreground"
      />
      <div className="flex min-w-0 items-center gap-2">
        <ClassIcon
          classId={person.classId}
          className={person.className}
          wrapperClassName="size-6"
        />
        <strong className="min-w-0 text-sm break-words">
          {person.gameNickname}
        </strong>
      </div>
      <span aria-hidden="true" />
      <span className="grid grid-cols-5 gap-x-2 text-[10px] leading-tight text-muted-foreground">
        {CHARACTER_STAT_FIELDS.map((field) => (
          <span key={field} className="grid">
            <span>{CHARACTER_STAT_LABELS[field]}</span>
            <strong className="font-medium text-foreground tabular-nums">
              {formatCharacterStat(field, person[field])}
            </strong>
          </span>
        ))}
      </span>
    </div>
  )
}

/** Счётчик полного состава групп для тех, кто видит все группы. */
export function EventGroupCount({ event }: { event: EventDetails }) {
  const { hasOfficerPermission } = useAccess()
  if (!hasOfficerPermission('events.view_full_roster')) {
    return null
  }
  const total = event.groups.reduce(
    (sum, group) => sum + group.members.length,
    0,
  )

  return (
    <div className="grid justify-items-center gap-1 text-center text-highlight">
      <strong className="text-4xl leading-none font-bold tabular-nums">
        {total}
      </strong>
      <span className="text-sm font-semibold">Людей в группе</span>
    </div>
  )
}

/**
 * Участники и группы события (EVT-06, GRP): офицер и администратор
 * распределяют людей до закрытия; остальные и закрытое событие — только
 * чтение (GRP-16).
 */
export function EventGroupsSection({
  event,
  classIds,
  onClassIdsChange,
  groupToolbarTarget,
  eventToolbarTarget,
}: {
  event: EventDetails
  classIds: number[]
  onClassIdsChange: (ids: number[]) => void
  groupToolbarTarget?: HTMLDivElement | null
  eventToolbarTarget?: HTMLDivElement | null
}) {
  const { hasOfficerPermission } = useAccess()
  const canViewAll = hasOfficerPermission('events.view_full_roster')
  const isMember = !canViewAll
  const currentUserId = useSession().session?.user.id
  const moveMember = useMoveMember()
  const [dragging, setDragging] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 6 },
    }),
  )
  const people = new Map(
    event.participants.map((person) => [person.id, person]),
  )
  for (const group of event.groups) {
    for (const member of group.members) {
      if (!people.has(member.userId) && member.profile) {
        people.set(member.userId, {
          id: member.userId,
          ...member.profile,
          answer: null,
          status: null,
        })
      }
    }
  }
  const board: Board = {
    event,
    people,
    currentUserId,
    editable: event.canManageGroups,
    move: (userId, target) =>
      void moveMember
        .mutateAsync({
          eventId: event.id,
          input: { eventId: event.id, userId, ...target },
        })
        .catch(reportError),
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    setDragging(null)
    if (!over) {
      return
    }
    const userId = String(active.id).replace('person:', '')
    const [kind, groupId, slot] = String(over.id).split(':')
    if (kind === 'pool' || kind === 'pool-row') {
      board.move(userId, { groupId: null, position: null })
    } else if (kind === 'group' && groupId) {
      board.move(userId, { groupId, position: null })
    } else if (kind === 'slot' && groupId) {
      board.move(userId, {
        groupId,
        position: finalPosition(event.groups, userId, groupId, Number(slot)),
      })
    }
  }

  const groupsPanel = (
    <section
      aria-label={isMember ? 'Ваша группа' : 'Группы события'}
      className={cn(
        'grid min-h-0 gap-3',
        !isMember &&
          'lg:sticky lg:top-4 lg:h-[calc(100svh-2rem)] lg:grid-rows-[minmax(0,1fr)]',
      )}
    >
      {isMember ? <h2 className={sectionTitleClass}>Ваша группа</h2> : null}
      {groupToolbarTarget === undefined && board.editable ? (
        <GroupToolbar board={board} />
      ) : null}
      {eventToolbarTarget === undefined && event.canClose ? (
        <EventToolbar board={board} />
      ) : null}
      {event.groups.length === 0 ? (
        <div className="min-h-0 rounded-xl border border-dashed border-border p-4 lg:overflow-y-auto">
          <p className="m-0 text-muted-foreground">
            {isMember
              ? 'Вы пока не распределены по группе'
              : event.canManageGroups
                ? 'Групп пока нет. Создайте группу или примените шаблон.'
                : 'Группы ещё не сформированы.'}
          </p>
        </div>
      ) : (
        <ul
          aria-label={isMember ? 'Ваша группа' : 'Группы события'}
          className="m-0 grid content-start min-h-0 list-none grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))] gap-2 overflow-y-auto p-0 lg:pr-1"
        >
          {event.groups.map((group) => (
            <li key={group.id} className="min-w-0">
              <GroupCard board={board} group={group} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )

  return (
    <DndContext
      sensors={sensors}
      accessibility={{
        announcements: announcements(event, board.people),
        screenReaderInstructions: {
          draggable:
            'Перетаскивание мышью или касанием. С клавиатуры используйте меню действий строки.',
        },
      }}
      onDragStart={({ active }) =>
        setDragging(String(active.id).replace('person:', ''))
      }
      onDragCancel={() => setDragging(null)}
      onDragEnd={onDragEnd}
    >
      <div className="grid">
        {isMember ? (
          groupsPanel
        ) : (
          <div className="grid items-start gap-3 lg:grid-cols-[minmax(18rem,23rem)_minmax(0,1fr)]">
            <PoolPanel
              board={board}
              classIds={classIds}
              onClassIdsChange={onClassIdsChange}
            />
            {groupsPanel}
          </div>
        )}
      </div>
      <DragOverlay>
        {dragging ? <DragPreview person={board.people.get(dragging)} /> : null}
      </DragOverlay>
      {groupToolbarTarget && board.editable
        ? createPortal(<GroupToolbar board={board} />, groupToolbarTarget)
        : null}
      {eventToolbarTarget && event.canClose
        ? createPortal(
            <EventToolbar board={board} className="justify-center" />,
            eventToolbarTarget,
          )
        : null}
    </DndContext>
  )
}
