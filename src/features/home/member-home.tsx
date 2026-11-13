import { Link } from '@tanstack/react-router'
import { ArrowRight, Trophy, Users, Vote } from 'lucide-react'
import type { MonthTopRow } from '@contracts/activity'
import type { RosterMember } from '@contracts/roster'
import { MANAGER_ROLES, ROLE_LABELS, hasRole, useAccess } from '@/app/access'
import { EmptyState } from '@/components/states/empty-state'
import { ErrorState } from '@/components/states/error-state'
import { LoadingState } from '@/components/states/loading-state'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Badge, Card } from '@/components/ui/surfaces'
import { useMonthTop } from '@/features/activity/api'
import { ClassIcon } from '@/features/catalog/class-icon'
import { useActiveEvents } from '@/features/events/api'
import { useActiveVotes } from '@/features/votes/api'
import { EventCard } from '@/features/events/event-card'
import { useRoster } from '@/features/roster/api'
import { formatMonth } from '@/lib/format-date'
import { cn } from '@/lib/utils'
import { NextEventHero } from './next-event-hero'
import { activeVotesLabel, membersLabel } from './plural'

/** Карточек событий после ближайшего на главной (HOM-07). */
const HOME_EVENTS = 3
/** Имена в кратком составе: администраторы и офицеры (HOM-07, ROS-08). */
const ROSTER_LEADERS = 6

const sectionClass = 'mt-12 grid gap-4'
const headClass = 'flex flex-wrap items-end justify-between gap-3'
const titleClass = 'm-0 text-2xl font-bold tracking-[-.02em]'

/**
 * События после ближайшего (оно — первый экран): тот же запрос и та же
 * карточка с ответом, что в расписании, — главная не хранит вторую копию
 * ответа (HOM-08). Если дальше ничего нет, блок не выводится.
 */
function UpcomingEvents() {
  const events = useActiveEvents()
  const later = events.data?.items.slice(1, 1 + HOME_EVENTS) ?? []
  if (later.length === 0) {
    return null
  }
  return (
    <section aria-labelledby="home-events" className={sectionClass}>
      <div className={headClass}>
        <h2 id="home-events" className={titleClass}>
          Дальше в расписании
        </h2>
        <Button asChild variant="secondary">
          <Link to="/events" search={{ tab: 'active' }}>
            Все события <ArrowRight aria-hidden="true" size={16} />
          </Link>
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {later.map((event) => (
          <EventCard key={event.id} event={event} />
        ))}
      </div>
    </section>
  )
}

function TopRow({ row, place }: { row: MonthTopRow; place: number }) {
  return (
    <li className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-surface-inset/60 px-3.5 py-3">
      <span
        className={cn(
          'grid size-8 flex-none place-items-center rounded-full border text-sm font-black tabular-nums',
          place === 1
            ? 'border-border-accent text-primary'
            : 'border-border text-muted-foreground',
        )}
      >
        {place}
      </span>
      <div className="grid min-w-0 flex-1 gap-0.5">
        <strong className="break-words">{row.gameNickname}</strong>
        <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5 text-[13px] text-muted-foreground">
          <ClassIcon classId={row.classId} className={row.className} />
          {row.className}
          {row.leaderCount > 0 ? (
            <span>· пати-лидер {row.leaderCount}</span>
          ) : null}
        </span>
      </div>
      <div className="grid flex-none justify-items-end gap-0.5 text-right">
        <strong className="text-primary tabular-nums">{row.percent}%</strong>
        <span className="text-[13px] text-muted-foreground tabular-nums">
          {row.visited} / {row.total}
        </span>
      </div>
    </li>
  )
}

/** Топ-5 текущего месяца (ACT-12); без посещений — сообщение (ACT-13). */
function MonthTop({ canSeeActivity }: { canSeeActivity: boolean }) {
  const top = useMonthTop()
  return (
    <section aria-labelledby="home-top" className={sectionClass}>
      <div className={headClass}>
        <div>
          <h2 id="home-top" className={titleClass}>
            Топ-5 посещаемости за месяц
          </h2>
          {top.data ? (
            <p className="m-0 mt-1 text-sm text-muted-foreground">
              {formatMonth(top.data.month)}
            </p>
          ) : null}
        </div>
        {canSeeActivity ? (
          <Button asChild variant="secondary">
            <Link to="/activity">
              Весь учёт <ArrowRight aria-hidden="true" size={16} />
            </Link>
          </Button>
        ) : null}
      </div>
      {top.isPending ? (
        <LoadingState label="Загрузка рейтинга…" rows={2} />
      ) : top.isError ? (
        <ErrorState onRetry={() => void top.refetch()} />
      ) : top.data.items.length === 0 ? (
        <EmptyState
          icon={<Trophy size={22} />}
          title="Пока нет данных"
          description="В этом месяце ещё нет закрытых событий с посещениями."
        />
      ) : (
        <ol className="m-0 grid list-none gap-2 p-0 lg:grid-cols-2">
          {top.data.items.map((row, index) => (
            <TopRow key={row.userId} row={row} place={index + 1} />
          ))}
        </ol>
      )}
    </section>
  )
}

const rankOf = (member: RosterMember) => (member.role === 'admin' ? 0 : 1)

/**
 * Краткий состав — представление `roster/list` (общий кеш со страницей
 * состава, Q-48): администраторы и офицеры поимённо, остальные числом.
 */
function RosterBrief() {
  const roster = useRoster()
  const leaders = (roster.data?.items ?? [])
    .filter((member) => member.role !== 'member')
    .sort(
      (a, b) =>
        rankOf(a) - rankOf(b) || a.gameNickname.localeCompare(b.gameNickname),
    )
  const shown = leaders.slice(0, ROSTER_LEADERS)
  const rest = (roster.data?.items.length ?? 0) - shown.length
  return (
    <Card className="grid content-start gap-4">
      <div className={headClass}>
        <h2 className="m-0 text-xl font-bold">Состав клана</h2>
        <Button asChild variant="ghost" className="px-2 py-1 text-[13px]">
          <Link to="/roster">
            Весь состав <ArrowRight aria-hidden="true" size={14} />
          </Link>
        </Button>
      </div>
      {roster.isPending ? (
        <LoadingState label="Загрузка состава…" rows={2} />
      ) : roster.isError ? (
        <ErrorState onRetry={() => void roster.refetch()} />
      ) : (
        <>
          <ul className="m-0 grid list-none gap-2.5 p-0">
            {shown.map((member) => (
              <li key={member.id} className="flex min-w-0 items-center gap-3">
                <Avatar
                  size="sm"
                  name={member.gameNickname}
                  src={member.avatarUrl}
                  alt=""
                />
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <strong className="break-words">{member.gameNickname}</strong>
                  <span className="inline-flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground">
                    <ClassIcon
                      classId={member.classId}
                      className={member.className}
                    />
                    {member.className}
                  </span>
                </div>
                <Badge className="flex-none">{ROLE_LABELS[member.role]}</Badge>
              </li>
            ))}
          </ul>
          {rest > 0 ? (
            <p className="m-0 inline-flex items-center gap-2 text-sm text-muted-foreground">
              <Users aria-hidden="true" size={16} />
              {shown.length > 0 ? 'И ещё' : 'В составе'}{' '}
              <strong className="text-foreground tabular-nums">{rest}</strong>{' '}
              {membersLabel(rest)}
            </p>
          ) : null}
        </>
      )}
    </Card>
  )
}

function VotesCard() {
  // Тот же кеш, что у раздела «Голосование»: отдельной операции нет.
  const votes = useActiveVotes()
  const count = votes.data?.activeCount
  const waiting =
    votes.data?.items.filter((vote) => vote.myOptionId === null).length ?? 0
  return (
    <Card className="grid content-start gap-3">
      <h2 className="m-0 text-xl font-bold">Голосования</h2>
      {count === undefined || count === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">
          {count === 0
            ? 'Сейчас голосований нет.'
            : 'Решения клана и приём новых участников.'}
        </p>
      ) : (
        <p className="m-0 text-sm text-muted-foreground">
          <strong className="text-2xl text-primary tabular-nums">
            {count}
          </strong>{' '}
          {activeVotesLabel(count)}
          {waiting > 0 ? ` · без вашего голоса: ${waiting}` : ''}
        </p>
      )}
      <Button asChild className="justify-self-start">
        <Link to="/votes">
          <Vote aria-hidden="true" size={16} /> К голосованиям
        </Link>
      </Button>
    </Card>
  )
}

/**
 * Главная внутренних ролей (HOM-07–09): ближайшее событие с ответом, затем
 * следующие события, топ, состав и голосования.
 */
export function MemberHome() {
  const { role } = useAccess()
  return (
    <>
      <NextEventHero />
      <UpcomingEvents />
      <MonthTop canSeeActivity={hasRole(role, MANAGER_ROLES)} />
      <div className="mt-12 grid gap-4 lg:grid-cols-2">
        <RosterBrief />
        <VotesCard />
      </div>
    </>
  )
}
