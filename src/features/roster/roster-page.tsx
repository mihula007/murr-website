import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { UserRoundX } from 'lucide-react'
import { z } from 'zod'
import type { RosterMember, RosterStatsResponse } from '@contracts/roster'
import { ROLE_LABELS, useAccess } from '@/app/access'
import { ConfirmActionDialog } from '@/components/confirm-action-dialog'
import { EmptyState } from '@/components/states/empty-state'
import { ErrorState } from '@/components/states/error-state'
import { LoadingState } from '@/components/states/loading-state'
import { PageHeader } from '@/components/states/page-header'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Badge, Card } from '@/components/ui/surfaces'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from '@/components/ui/toaster'
import { MEMBER_LIST_LIMIT } from '@contracts/paging'
import { useSetRole } from '@/features/admin/api'
import { useSession } from '@/features/auth/session'
import { ClassIcon } from '@/features/catalog/class-icon'
import { useRoster, useRosterStats } from './api'
import { ReadersPanel } from './readers-panel'

const ALL = 'all'

/**
 * Параметры адреса состава: фильтр класса и вкладка. Чтецы — отдельная
 * вкладка: их список догружается бесконечно.
 */
export const rosterSearchSchema = z.object({
  classId: z.number().int().positive().optional().catch(undefined),
  view: z.enum(['members', 'readers']).catch('members'),
})
export type RosterSearch = z.output<typeof rosterSearchSchema>

/**
 * Общая численность и распределение по классам (ROS-05). Как в прототипе,
 * показываются только классы с участниками; фильтр предлагает весь справочник.
 */
function StatsPanel({ roster }: { roster: RosterStatsResponse }) {
  return (
    <section
      aria-labelledby="roster-stats-title"
      className="grid grid-cols-[auto_1px_minmax(0,1fr)] items-center gap-5 rounded-2xl border border-border-accent bg-linear-125/srgb from-surface-from to-surface-to p-5 max-sm:gap-3 max-sm:p-4"
    >
      <div className="flex min-w-[76px] flex-col">
        <span
          id="roster-stats-title"
          className="mb-2.5 text-2xs font-extrabold tracking-[.16em] text-primary uppercase max-sm:tracking-[.1em]"
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
        className="h-[78px] bg-linear-180/srgb from-transparent via-border-accent to-transparent"
      />
      <ul
        aria-label="По классам"
        className="m-0 flex max-h-[112px] list-none flex-wrap gap-[7px] overflow-auto p-0 pr-1"
      >
        {roster.classes
          .filter((item) => item.count > 0)
          .map((item) => (
            <li
              key={item.classId}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-inset py-0.5 pr-2 pl-0.5 text-xs max-sm:text-2xs"
            >
              <ClassIcon
                classId={item.classId}
                className={item.className}
                wrapperClassName="size-[21px] max-sm:size-[18px]"
              />
              {item.className}
              <b className="inline-grid h-[19px] min-w-[19px] place-items-center rounded-full bg-linear-135/srgb from-button-primary-from to-button-primary-to px-1 text-2xs text-primary-foreground">
                {item.count}
              </b>
            </li>
          ))}
      </ul>
    </section>
  )
}

type MemberCardProps = {
  member: RosterMember
  onBlock?: (() => void) | undefined
}

function MemberCard({ member, onBlock }: MemberCardProps) {
  return (
    <Card className="flex h-full flex-col gap-4 p-[18px]">
      <div className="flex min-w-0 items-center gap-3.5">
        <Avatar
          size="sm"
          name={member.gameNickname}
          src={member.avatarUrl}
          alt=""
        />
        <div className="grid min-w-0 gap-1">
          <h3 className="text-xl leading-tight font-bold break-words">
            {member.gameNickname}
          </h3>
          <span className="inline-flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
            <ClassIcon classId={member.classId} className={member.className} />
            {member.className}
          </span>
        </div>
      </div>
      {member.role !== 'member' || onBlock ? (
        <div className="mt-auto flex flex-wrap items-end justify-between gap-2">
          {onBlock ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onBlock}
            >
              <UserRoundX size={14} aria-hidden="true" /> Присвоить статус
              «Чтец»
            </Button>
          ) : null}
          {member.role !== 'member' ? (
            <Badge className="ml-auto">{ROLE_LABELS[member.role]}</Badge>
          ) : null}
        </div>
      ) : null}
    </Card>
  )
}

function MembersList({
  classId,
  isAdmin,
  userId,
  onBlock,
}: {
  classId: number | null
  isAdmin: boolean
  userId: string | undefined
  onBlock: (member: RosterMember) => void
}) {
  const roster = useRoster()
  if (roster.isPending) {
    return <LoadingState label="Загружаем состав…" />
  }
  if (roster.isError) {
    return <ErrorState onRetry={() => void roster.refetch()} />
  }
  const members =
    classId === null
      ? roster.data.items
      : roster.data.items.filter((member) => member.classId === classId)
  if (members.length === 0) {
    return (
      <EmptyState
        title="Никого нет"
        description={
          classId === null
            ? 'В составе пока нет участников.'
            : 'В составе нет участников этого класса.'
        }
      />
    )
  }
  // Участников клана до 200 (Q-48): весь список рисуется без виртуализации.
  return (
    <>
      <ul
        aria-label="Участники"
        className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3"
      >
        {members.map((member) => (
          <li key={member.id} className="min-w-0">
            <MemberCard
              member={member}
              onBlock={
                isAdmin && member.role === 'member' && member.id !== userId
                  ? () => onBlock(member)
                  : undefined
              }
            />
          </li>
        ))}
      </ul>
      {roster.data.truncated ? (
        <output className="mt-4 block text-sm text-muted-foreground">
          Показаны первые {MEMBER_LIST_LIMIT} участников по нику.
        </output>
      ) : null}
    </>
  )
}

/** Состав клана для внутренних ролей (ROS-01–09, ACL-09). */
export function RosterPage({
  classId,
  view = 'members',
}: Partial<RosterSearch>) {
  const { role } = useAccess()
  const userId = useSession().session?.user.id
  const navigate = useNavigate()
  const stats = useRosterStats()
  const setRole = useSetRole()
  const [blocking, setBlocking] = useState<RosterMember | null>(null)
  const isAdmin = role === 'admin'
  const canRestore = role === 'officer' || role === 'admin'
  const showReaders = canRestore && view === 'readers'
  const go = (search: RosterSearch) =>
    void navigate({ to: '/roster', search, replace: true })

  let filters
  if (stats.isPending) {
    filters = <LoadingState label="Загружаем статистику…" rows={1} />
  } else if (stats.isError) {
    filters = <ErrorState onRetry={() => void stats.refetch()} />
  } else {
    filters = (
      <div className="mb-[18px] grid grid-cols-[minmax(260px,.68fr)_minmax(0,1.32fr)] items-end gap-6 max-[900px]:grid-cols-1 max-[900px]:gap-3.5">
        <div className="grid gap-2">
          <label
            htmlFor="roster-class"
            className="text-sm text-muted-foreground"
          >
            Класс
          </label>
          <Select
            id="roster-class"
            value={classId === undefined ? ALL : String(classId)}
            onValueChange={(value) =>
              go({
                view: 'members',
                classId: value === ALL ? undefined : Number(value),
              })
            }
            options={[
              { value: ALL, label: 'Все классы' },
              ...stats.data.classes.map((item) => ({
                value: String(item.classId),
                label: item.className,
              })),
            ]}
          />
        </div>
        <StatsPanel roster={stats.data} />
      </div>
    )
  }

  return (
    <section>
      <PageHeader
        eyebrow="Клан"
        title="Состав"
        description="Текущие участники клана: члены, офицеры и администраторы."
      />
      {canRestore ? (
        <Tabs
          value={showReaders ? 'readers' : 'members'}
          onValueChange={(value) =>
            go({ view: value === 'readers' ? 'readers' : 'members', classId })
          }
        >
          <TabsList aria-label="Состав" className="mb-4">
            <TabsTrigger value="members">Участники</TabsTrigger>
            <TabsTrigger value="readers">Чтецы</TabsTrigger>
          </TabsList>
        </Tabs>
      ) : null}
      {showReaders ? (
        <ReadersPanel />
      ) : (
        <>
          {filters}
          <MembersList
            classId={classId ?? null}
            isAdmin={isAdmin}
            userId={userId}
            onBlock={setBlocking}
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
    </section>
  )
}
