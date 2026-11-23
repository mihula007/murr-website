import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ChartNoAxesCombined, MoreHorizontal, UserRoundX } from 'lucide-react'
import { z } from 'zod'
import type { RosterMember, RosterStatsResponse } from '@contracts/roster'
import {
  CHARACTER_STAT_FIELDS,
  CHARACTER_STAT_LABELS,
} from '@contracts/character-stats'
import { ROLE_LABELS, useAccess } from '@/app/access'
import { ConfirmActionDialog } from '@/components/confirm-action-dialog'
import { EmptyState } from '@/components/states/empty-state'
import { ErrorState } from '@/components/states/error-state'
import { LoadingState } from '@/components/states/loading-state'
import { PageHeader } from '@/components/states/page-header'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Badge, tileClass } from '@/components/ui/surfaces'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from '@/components/ui/toaster'
import {
  pagingOf,
  ScrollableVirtualList,
  useGridColumns,
  VirtualList,
} from '@/components/virtual-list'
import { useSetRole } from '@/features/admin/api'
import { useSession } from '@/features/auth/session'
import { ClassIcon } from '@/features/catalog/class-icon'
import { cn } from '@/lib/utils'
import {
  rosterBackgroundForClass,
  rosterBackgroundPositionForClass,
} from './backgrounds'
import { useRestoreReader, useRosterPages, useRosterStats } from './api'
import { formatCharacterStat } from './character-stats'
import { ReadersPanel } from './readers-panel'
import { MemberDynamicsDialog } from './member-dynamics-dialog'

const MASTER_ROLE_CHOICES = {
  member: ['officer', 'reader'],
  officer: ['member', 'reader'],
  reader: ['member', 'officer'],
} as const
type MasterRole =
  (typeof MASTER_ROLE_CHOICES)[keyof typeof MASTER_ROLE_CHOICES][number]

function masterRoleChoices(
  currentRole: RosterMember['role'],
): readonly MasterRole[] {
  return currentRole in MASTER_ROLE_CHOICES
    ? MASTER_ROLE_CHOICES[currentRole as keyof typeof MASTER_ROLE_CHOICES]
    : []
}

/** Параметры адреса состава: фильтр класса и вкладка «Чтецы». */
export const rosterSearchSchema = z.object({
  classId: z.number().int().positive().optional().catch(undefined),
  classIds: z
    .array(z.number().int().positive())
    .max(17)
    .optional()
    .catch(undefined),
  view: z.enum(['members', 'readers']).catch('members'),
})
export type RosterSearch = z.output<typeof rosterSearchSchema>

/** Общая численность и распределение по классам; значки служат фильтрами. */
function StatsPanel({
  roster,
  selectedClassIds,
  onToggleClass,
}: {
  roster: RosterStatsResponse
  selectedClassIds: number[]
  onToggleClass: (classId: number) => void
}) {
  return (
    <section
      aria-labelledby="roster-stats-title"
      className="grid grid-cols-[auto_1px_minmax(0,1fr)] items-center gap-5 rounded-2xl border border-border-accent bg-linear-125/srgb from-surface-from to-surface-to p-5 max-sm:grid-cols-1 max-sm:gap-3 max-sm:p-4"
    >
      <div className="flex min-w-[76px] flex-col">
        <span
          id="roster-stats-title"
          className="mb-2 text-sm font-semibold text-muted-foreground"
        >
          В составе
        </span>
        <strong className="text-[46px] leading-none font-extrabold text-highlight max-sm:text-[38px]">
          {roster.total}
        </strong>
        <span className="mt-1.5 text-xs text-muted-foreground">участников</span>
      </div>
      <span
        aria-hidden="true"
        className="h-[78px] bg-linear-180/srgb from-transparent via-border-accent to-transparent max-sm:hidden"
      />
      <ul
        aria-label="По классам"
        className="m-0 flex list-none flex-wrap gap-2 p-0"
      >
        {roster.classes.map((item) => (
          <li key={item.classId} className="list-none">
            <button
              type="button"
              aria-label={`Фильтр по классу ${item.className}`}
              aria-pressed={selectedClassIds.includes(item.classId)}
              onClick={() => onToggleClass(item.classId)}
              className={cn(
                'inline-flex items-center gap-2 rounded-full border border-border bg-surface-inset py-1 pr-2.5 pl-1 text-left text-sm transition-colors hover:border-border-accent focus-visible:ring-2 focus-visible:ring-border-accent',
                selectedClassIds.includes(item.classId) &&
                  'border-highlight bg-highlight text-background shadow-sm',
              )}
            >
              <ClassIcon
                classId={item.classId}
                className={item.className}
                wrapperClassName="size-6"
              />
              {item.className}
              <b className="inline-grid h-[22px] min-w-[22px] place-items-center rounded-full bg-linear-135/srgb from-button-primary-from to-button-primary-to px-1 text-2xs text-primary-foreground">
                {item.count}
              </b>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

type MemberCardProps = {
  member: RosterMember
  isCurrentUser: boolean
  onBlock?: (() => void) | undefined
  onChangeRole?: ((role: MasterRole) => void) | undefined
  onDynamics: () => void
}

function CharacterStatsSummary({ member }: { member: RosterMember }) {
  return (
    <dl
      aria-label={`Характеристика ${member.gameNickname}`}
      className="col-span-full m-0 grid grid-cols-5 gap-1"
    >
      {CHARACTER_STAT_FIELDS.map((field) => (
        <div
          key={field}
          className="grid min-w-0 justify-items-center rounded-md border border-border/70 bg-background/60 px-0.5 py-1.5 text-center backdrop-blur-[2px]"
        >
          <dt className="text-2xs leading-tight text-muted-foreground">
            {CHARACTER_STAT_LABELS[field]}
          </dt>
          <dd className="m-0 text-sm font-semibold whitespace-nowrap text-foreground tabular-nums">
            {formatCharacterStat(field, member[field])}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** Карточка участника; действие офицера и администратора — в меню «⋯» (ROS-07). */
function MemberCard({
  member,
  isCurrentUser,
  onBlock,
  onChangeRole,
  onDynamics,
}: MemberCardProps) {
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    if (!menuOpen) {
      return
    }

    const closeMenu = () => setMenuOpen(false)
    window.addEventListener('scroll', closeMenu, true)
    return () => window.removeEventListener('scroll', closeMenu, true)
  }, [menuOpen])

  return (
    <div
      className={cn(
        tileClass,
        'relative isolate flex h-full min-h-[132px] flex-col gap-4 overflow-hidden border border-border-accent/80 shadow-sm',
        isCurrentUser && 'bg-item-highlight!',
        isCurrentUser && 'border-2! border-highlight!',
        isCurrentUser && 'ring-2 ring-highlight',
      )}
    >
      {rosterBackgroundForClass(member.classId) ? (
        <img
          aria-hidden="true"
          alt=""
          loading="lazy"
          src={rosterBackgroundForClass(member.classId)}
          className={cn(
            'absolute inset-0 -z-10 size-full object-cover',
            rosterBackgroundPositionForClass(member.classId) === 'right'
              ? 'object-right'
              : 'object-center',
          )}
        />
      ) : null}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-linear-90/srgb from-background/95 via-background/78 to-background/42"
      />
      <div className="relative grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3.5 gap-y-2">
        <Avatar
          size="sm"
          name={member.gameNickname}
          src={member.avatarUrl}
          alt=""
        />
        <div className="grid min-h-14 min-w-0 content-between gap-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-xl leading-tight font-bold break-words">
              {member.gameNickname}
            </h3>
            <span className="text-sm text-muted-foreground">
              {member.className}
            </span>
            {member.role !== 'member' ? (
              <Badge>{ROLE_LABELS[member.role]}</Badge>
            ) : null}
          </div>
          <div aria-hidden="true" className="flex items-center gap-2 py-1.5">
            <hr className="h-px flex-1 border-0 bg-highlight/60" />
            <span className="size-1.5 rotate-45 border border-highlight bg-background/85" />
            <hr className="h-px flex-1 border-0 bg-highlight/60" />
          </div>
        </div>
        {onBlock || onChangeRole ? (
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="flex-none px-2"
                aria-label={`Действия с участником «${member.gameNickname}»`}
              >
                <MoreHorizontal size={18} aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onChangeRole
                ? masterRoleChoices(member.role).map((role) => (
                    <DropdownMenuItem
                      key={role}
                      onSelect={() => onChangeRole(role)}
                    >
                      Назначить роль «{ROLE_LABELS[role]}»
                    </DropdownMenuItem>
                  ))
                : onBlock && (
                    <DropdownMenuItem onSelect={onBlock}>
                      <span className="inline-flex items-center gap-2">
                        <UserRoundX size={16} aria-hidden="true" />
                        Присвоить статус «Чтец»
                      </span>
                    </DropdownMenuItem>
                  )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        <CharacterStatsSummary member={member} />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="col-span-full justify-self-start"
          onClick={onDynamics}
        >
          <ChartNoAxesCombined size={15} aria-hidden="true" />
          Динамика развития
        </Button>
      </div>
    </div>
  )
}

function MembersList({
  classIds,
  canAssignReader,
  canManageRoles,
  userId,
  onBlock,
  onChangeRole,
  onDynamics,
}: {
  classIds: number[]
  canAssignReader: boolean
  canManageRoles: boolean
  userId: string | undefined
  onBlock: (member: RosterMember) => void
  onChangeRole: (member: RosterMember, role: MasterRole) => void
  onDynamics: (member: RosterMember) => void
}) {
  const columns = { base: 1, sm: 2, lg: 3 }
  const activeColumns = useGridColumns(columns)
  const roster = useRosterPages({ classIds })
  if (roster.isPending) {
    return <LoadingState label="Загружаем состав…" />
  }
  if (roster.isError) {
    return <ErrorState onRetry={() => void roster.refetch()} />
  }
  const members = roster.data.pages.flatMap((page) => page.items)
  if (members.length === 0) {
    const description =
      classIds.length > 0
        ? 'В составе нет участников выбранных классов.'
        : 'В составе пока нет участников.'
    return <EmptyState title="Никого нет" description={description} />
  }
  const renderMember = (member: RosterMember) => (
    <MemberCard
      member={member}
      onDynamics={() => onDynamics(member)}
      isCurrentUser={member.id === userId}
      onBlock={
        !canManageRoles &&
        canAssignReader &&
        member.role === 'member' &&
        member.id !== userId
          ? () => onBlock(member)
          : undefined
      }
      onChangeRole={
        canManageRoles &&
        (member.role === 'member' || member.role === 'officer') &&
        member.id !== userId
          ? (role) => onChangeRole(member, role)
          : undefined
      }
    />
  )
  const paging = pagingOf(roster)
  return activeColumns === 1 ? (
    <VirtualList
      items={members}
      getKey={(member) => member.id}
      renderItem={renderMember}
      label="Участники"
      estimateSize={150}
      columns={1}
      gridClassName="grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
      paging={paging}
      gap="md"
    />
  ) : (
    <ScrollableVirtualList
      items={members}
      getKey={(member) => member.id}
      renderItem={renderMember}
      label="Участники"
      estimateSize={150}
      viewportRows={4}
      maxViewportHeightOffset={512}
      columns={columns}
      stableScrollbarGutter
      gridClassName="grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 px-3"
      paging={paging}
      gap="md"
    />
  )
}

/** Состав клана для внутренних ролей (ROS-01–09, ACL-09). */
export function RosterPage({
  classId,
  classIds,
  view = 'members',
}: Partial<RosterSearch>) {
  const { role, hasOfficerPermission } = useAccess()
  const userId = useSession().session?.user.id
  const navigate = useNavigate()
  const stats = useRosterStats()
  const setRole = useSetRole()
  const restoreReader = useRestoreReader()
  const [blocking, setBlocking] = useState<RosterMember | null>(null)
  const [dynamicsMember, setDynamicsMember] = useState<RosterMember | null>(
    null,
  )
  const [changing, setChanging] = useState<{
    member: RosterMember
    role: MasterRole
  } | null>(null)
  const canManageRoles = role === 'master'
  const canRestore = hasOfficerPermission('roster.reader_roles')
  const showReaders = canRestore && view === 'readers'
  const selectedClassIds = useMemo(
    () =>
      [...new Set(classIds ?? (classId === undefined ? [] : [classId]))].sort(
        (a, b) => a - b,
      ),
    [classId, classIds],
  )
  const classFilterSearch = useMemo(
    () => ({
      ...(selectedClassIds.length > 0 ? { classIds: selectedClassIds } : {}),
    }),
    [selectedClassIds],
  )
  const go = (nextSearch: RosterSearch) =>
    void navigate({
      to: '/roster',
      search: nextSearch,
      replace: true,
      resetScroll: false,
    })

  const toggleClass = (nextClassId: number) => {
    const next = selectedClassIds.includes(nextClassId)
      ? selectedClassIds.filter((id) => id !== nextClassId)
      : [...selectedClassIds, nextClassId].sort((a, b) => a - b)
    go({
      view: 'members',
      ...(next.length > 0 ? { classIds: next } : {}),
    })
  }

  let filters
  if (stats.isPending) {
    filters = <LoadingState label="Загружаем статистику…" rows={1} />
  } else if (stats.isError) {
    filters = <ErrorState onRetry={() => void stats.refetch()} />
  } else {
    filters = (
      <div className="mb-[18px]">
        <StatsPanel
          roster={stats.data}
          selectedClassIds={selectedClassIds}
          onToggleClass={toggleClass}
        />
      </div>
    )
  }

  return (
    <section>
      <PageHeader
        title="Состав"
        description="Текущие участники клана: члены, офицеры, мастера и администраторы."
        className="-mt-6 mb-3 max-[900px]:mt-0 max-[900px]:mb-6"
      />
      {canRestore ? (
        <Tabs
          value={showReaders ? 'readers' : 'members'}
          onValueChange={(value) =>
            go({
              view: value === 'readers' ? 'readers' : 'members',
              ...classFilterSearch,
            })
          }
        >
          <TabsList aria-label="Состав" className="mb-4">
            <TabsTrigger value="members">Участники</TabsTrigger>
            <TabsTrigger value="readers">Чтецы</TabsTrigger>
          </TabsList>
        </Tabs>
      ) : null}
      {showReaders ? (
        <ReadersPanel
          canManageRoles={canManageRoles}
          onChangeRole={(member, nextRole) =>
            setChanging({ member, role: nextRole })
          }
        />
      ) : (
        <>
          {filters}
          <MembersList
            classIds={selectedClassIds}
            canAssignReader={canRestore && !canManageRoles}
            canManageRoles={canManageRoles}
            userId={userId}
            onBlock={setBlocking}
            onChangeRole={(member, nextRole) =>
              setChanging({ member, role: nextRole })
            }
            onDynamics={setDynamicsMember}
          />
        </>
      )}
      <ConfirmActionDialog
        open={blocking !== null}
        onOpenChange={(open) => {
          if (!open) {
            setBlocking(null)
          }
        }}
        title={`Присвоить ${blocking?.gameNickname ?? ''} статус «Чтец»?`}
        description="Участник выйдет из состава и потеряет внутренний доступ. Аккаунт, профиль и дата вступления сохранятся; восстановить его может офицер или администратор."
        confirmLabel="Присвоить «Чтец»"
        pendingLabel="Сохраняем…"
        onConfirm={async () => {
          if (!blocking) {
            return
          }
          await setRole.mutateAsync({ userId: blocking.id, role: 'reader' })
          toast(`${blocking.gameNickname} теперь чтец`)
        }}
      />
      <MemberDynamicsDialog
        member={dynamicsMember}
        open={dynamicsMember !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDynamicsMember(null)
          }
        }}
      />
      <ConfirmActionDialog
        open={changing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setChanging(null)
          }
        }}
        title={`Сменить роль ${changing?.member.gameNickname ?? ''} на «${changing ? ROLE_LABELS[changing.role] : ''}»?`}
        description="Изменение будет записано в журнал, а участнику придёт уведомление."
        confirmLabel="Сменить роль"
        pendingLabel="Сохраняем…"
        onConfirm={async () => {
          if (!changing) {
            return
          }
          if (changing.member.role === 'reader' && changing.role === 'member') {
            await restoreReader.mutateAsync({ userId: changing.member.id })
          } else {
            await setRole.mutateAsync({
              userId: changing.member.id,
              role: changing.role,
            })
          }
          toast(
            `${changing.member.gameNickname}: новая роль — ${ROLE_LABELS[changing.role]}`,
          )
        }}
      />
    </section>
  )
}
