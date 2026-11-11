import { useState, type ReactNode } from 'react'
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
  Copy,
  EllipsisVertical,
  GripVertical,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import {
  EVENT_ANSWER_LABELS,
  type EventDetails,
  type EventParticipant,
} from '@contracts/events'
import { ATTENDANCE_STATUS_LABELS, type EventGroup } from '@contracts/groups'
import { MEMBER_LIST_LIMIT } from '@contracts/paging'
import { ConfirmActionDialog } from '@/components/confirm-action-dialog'
import { Button } from '@/components/ui/button'
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
import { Badge, Card } from '@/components/ui/surfaces'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from '@/components/ui/toaster'
import { ClassIcon } from '@/features/catalog/class-icon'
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
import { GroupNameDialog } from './group-name-dialog'
import { GroupTemplatesDialog } from './group-templates-dialog'

const sectionTitleClass =
  'm-0 text-xs font-extrabold tracking-[0.16em] text-primary uppercase'

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
  /** Группа и номер строки; нет — строка свободного списка. */
  group?: EventGroup
  index?: number
  isLeader?: boolean
}

/** Строка участника: перетаскивание за маркер и меню переноса (GRP-04, GRP-07). */
function PersonRow({ board, person, group, index, isLeader }: PersonRowProps) {
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
  const others = board.event.groups.filter((item) => item.id !== group?.id)
  const size = group?.members.length ?? 0

  return (
    <li
      ref={dropRef}
      className={cn(
        'flex min-w-0 items-center gap-2 rounded-lg border border-border bg-surface-inset px-2 py-1.5',
        isDragging && 'opacity-40',
        isOver && 'border-primary',
      )}
    >
      {board.editable ? (
        <button
          ref={dragRef}
          type="button"
          className="grid size-8 flex-none cursor-grab touch-none place-items-center rounded-md border-0 bg-transparent text-muted-foreground hover:text-primary"
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
      <ClassIcon classId={person.classId} className={person.className} />
      <span className="grid min-w-0 flex-1">
        <strong className="text-sm break-words">
          {person.gameNickname}
          {isLeader ? (
            <span className="font-normal text-primary"> — Пати лидер</span>
          ) : null}
        </strong>
        <span className="text-xs text-muted-foreground">
          {person.className}
          {person.status
            ? ` · ${ATTENDANCE_STATUS_LABELS[person.status]}`
            : person.answer
              ? ` · ${EVENT_ANSWER_LABELS[person.answer]}`
              : ' · Без ответа'}
        </span>
      </span>
      {board.editable ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 flex-none"
              aria-label={`Действия: ${person.gameNickname}`}
            >
              <EllipsisVertical size={16} aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
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
            {group && index !== undefined ? (
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
    </li>
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
function PoolPanel({ board }: { board: Board }) {
  const closed = board.event.closedAt !== null
  const tabs = closed ? STATUS_TABS : ANSWER_TABS
  const [tab, setTab] = useState(tabs[0]!.value)
  const [search, setSearch] = useState('')
  const { setNodeRef: dropRef, isOver } = useDroppable({
    id: 'pool',
    disabled: !board.editable,
  })
  const assigned = new Set(
    board.event.groups.flatMap((group) => group.members.map((m) => m.userId)),
  )
  const free = closed
    ? board.event.participants
    : board.event.participants.filter((person) => !assigned.has(person.id))
  const current = tabs.find((item) => item.value === tab) ?? tabs[0]!
  const query = search.trim().toLocaleLowerCase('ru-RU')
  const shown = free
    .filter(current.test)
    .filter(
      (person) =>
        !query ||
        `${person.gameNickname} ${person.className}`
          .toLocaleLowerCase('ru-RU')
          .includes(query),
    )

  return (
    <Card
      ref={dropRef}
      className={cn('grid content-start gap-3', isOver && 'border-primary')}
    >
      <h2 className={sectionTitleClass}>
        {closed ? 'Итог посещения' : 'Участники'}
      </h2>
      <Tabs value={current.value} onValueChange={setTab}>
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
                {free.filter(item.test).length}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <Input
        type="search"
        aria-label="Поиск по нику или классу"
        placeholder="Поиск по нику или классу"
        value={search}
        onChange={(change) => setSearch(change.target.value)}
      />
      {board.editable ? (
        <p className="m-0 text-xs text-muted-foreground">
          Назначенные в группы скрываются из вкладок. Перетащите человека за
          маркер или выберите группу в меню «⋮»; перенос сюда снимает его с
          группы.
        </p>
      ) : null}
      {shown.length === 0 ? (
        <p className="m-0 text-muted-foreground">Никого нет.</p>
      ) : (
        <ul
          aria-label={current.label}
          className="m-0 grid list-none gap-1.5 p-0"
        >
          {shown.map((person) => (
            <PersonRow key={person.id} board={board} person={person} />
          ))}
        </ul>
      )}
      {board.event.participantsTruncated ? (
        <output className="text-sm text-muted-foreground">
          Показаны первые {MEMBER_LIST_LIMIT} участников по нику.
        </output>
      ) : null}
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
      className={cn('grid content-start gap-3', isOver && 'border-primary')}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <h3 className="m-0 min-w-0 flex-1 text-base font-bold break-words">
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
            className="size-8"
            aria-label={`Переименовать «${group.name}»`}
            onClick={() => setRenaming(true)}
          >
            <Pencil size={14} aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      {board.editable ? (
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2 max-xs:grid-cols-2">
          <Select
            aria-label={`Лидер группы «${group.name}»`}
            className="max-xs:col-span-full"
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
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void copyNicks()}
          >
            <Copy size={14} aria-hidden="true" /> Ники
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="text-destructive"
            onClick={() => setDeleting(true)}
          >
            <Trash2 size={14} aria-hidden="true" /> Удалить
          </Button>
        </div>
      ) : null}
      {members.length === 0 ? (
        <p className="m-0 rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          {board.editable
            ? 'Перетащите участников сюда или выберите группу в меню «⋮».'
            : 'В группе никого нет.'}
        </p>
      ) : (
        <ol
          aria-label={`Состав «${group.name}»`}
          className="m-0 grid list-none gap-1.5 p-0"
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

/** Панель офицера: новая группа, шаблоны, закрытие события (GRP-03, EVT-08). */
function Toolbar({ board }: { board: Board }) {
  const { event } = board
  const create = useCreateGroup()
  const close = useCloseEvent()
  const [creating, setCreating] = useState(false)
  const [templates, setTemplates] = useState(false)
  const [closing, setClosing] = useState(false)
  const hasGroups = event.groups.length > 0

  return (
    <div className="flex flex-wrap gap-2">
      {board.editable ? (
        <>
          <Button type="button" onClick={() => setCreating(true)}>
            <Plus size={16} aria-hidden="true" /> Создать группу
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setTemplates(true)}
          >
            Шаблоны групп
          </Button>
        </>
      ) : null}
      {event.canClose ? (
        <Button
          type="button"
          variant="outline"
          className="ml-auto max-xs:ml-0"
          onClick={() => setClosing(true)}
        >
          Завершить событие
        </Button>
      ) : null}
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
      {board.editable ? (
        <GroupTemplatesDialog
          open={templates}
          onOpenChange={setTemplates}
          event={event}
        />
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
    <div className="flex items-center gap-2 rounded-lg border border-primary bg-surface-menu px-3 py-2 shadow-popover">
      <ClassIcon classId={person.classId} className={person.className} />
      <strong className="text-sm">{person.gameNickname}</strong>
    </div>
  )
}

/**
 * Участники и группы события (EVT-06, GRP): офицер и администратор
 * распределяют людей до закрытия; остальные и закрытое событие — только
 * чтение (GRP-16).
 */
export function EventGroupsSection({ event }: { event: EventDetails }) {
  const moveMember = useMoveMember()
  const [dragging, setDragging] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 6 },
    }),
  )
  const board: Board = {
    event,
    people: new Map(event.participants.map((person) => [person.id, person])),
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

  const showToolbar = event.canManageGroups || event.canClose

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
      <div className="grid gap-4">
        {showToolbar ? <Toolbar board={board} /> : null}
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
          <PoolPanel board={board} />
          <section aria-labelledby="event-groups-title" className="grid gap-3">
            <div className="flex items-center gap-2">
              <h2 id="event-groups-title" className={sectionTitleClass}>
                Группы
              </h2>
              <Badge className="border-border text-muted-foreground">
                {event.groups.length}
              </Badge>
            </div>
            {event.groups.length === 0 ? (
              <Card>
                <p className="m-0 text-muted-foreground">
                  {event.canManageGroups
                    ? 'Групп пока нет. Создайте группу или примените шаблон.'
                    : 'Группы ещё не сформированы.'}
                </p>
              </Card>
            ) : (
              event.groups.map((group) => (
                <GroupCard key={group.id} board={board} group={group} />
              ))
            )}
          </section>
        </div>
      </div>
      <DragOverlay>
        {dragging ? <DragPreview person={board.people.get(dragging)} /> : null}
      </DragOverlay>
    </DndContext>
  )
}
