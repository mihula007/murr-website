import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import { INTERNAL_ROLES, hasRole, useAccess } from '@/app/access'
import { Button } from '@/components/ui/button'
import { useMe } from '@/features/account/use-me'
import { ApplicantPath } from '@/features/applications/applicant-path'
import { useRosterCount } from '@/features/roster/api'
import { ActiveEventsStat, MemberHome } from './member-home'
import { membersLabel } from './plural'

/**
 * Численность состава видна всем ролям, включая гостя и чтеца (HOM-04). Состав
 * на главной видят только внутренние роли (HOM-11, ROS-08). Без связи с
 * сервером блок не выводится.
 */
function MembersStat() {
  const count = useRosterCount()
  if (count.isError) {
    return null
  }
  return (
    <section
      aria-label="Численность клана"
      className="grid min-w-[150px] gap-0.5 rounded-xl border border-border bg-surface-inset/80 px-4 py-3"
    >
      <strong className="text-2xl text-primary" aria-live="polite">
        {count.data ?? '—'}
      </strong>
      <span className="text-xs text-muted-foreground">
        {count.data === undefined ? 'участников' : membersLabel(count.data)}
      </span>
    </section>
  )
}

/**
 * Главная: приветствие и численность для всех; вход для гостя, путь кандидата
 * (HOM-04–06); события, топ месяца, состав и голосования — внутренним ролям
 * (HOM-07–09).
 */
export function HomePage() {
  const { status, role } = useAccess()
  const internal = hasRole(role, INTERNAL_ROLES)
  const me = useMe()
  const applicant =
    role === 'applicant' && me.data?.state === 'ready' ? me.data : null
  return (
    <>
      <section className="max-w-2xl py-3">
        <p className="text-xs font-extrabold tracking-[.2em] text-primary uppercase">
          ✦ Сила в единстве ✦
        </p>
        <h1 className="mt-4 text-[clamp(38px,5vw,58px)] leading-[1.03] font-bold tracking-[-.04em]">
          Легенда продолжается
          <br />
          <span className="text-primary">Вместе с Murr</span>
        </h1>
        <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-muted-foreground">
          {internal
            ? 'Дом для тех, кто идёт в бой плечом к плечу. Планируй ивенты, собирай пати и знакомься с сокланами.'
            : 'Готовим общее пространство для участников. Здесь появятся новости, встречи и жизнь гильдии.'}
        </p>
        {internal ? (
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild>
              <Link to="/events">
                Посмотреть ивенты <ArrowRight aria-hidden="true" size={16} />
              </Link>
            </Button>
          </div>
        ) : null}
        <div className="mt-7 flex flex-wrap gap-3">
          <MembersStat />
          {internal ? <ActiveEventsStat /> : null}
        </div>
        {status === 'guest' ? (
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild>
              <Link to="/register">Вступить в клан</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link to="/login">Вход</Link>
            </Button>
          </div>
        ) : null}
      </section>
      {applicant ? (
        <ApplicantPath
          application={applicant.application}
          canResubmit={applicant.canResubmit}
          className="mt-8 max-w-[920px]"
        />
      ) : null}
      {internal ? <MemberHome /> : null}
    </>
  )
}
