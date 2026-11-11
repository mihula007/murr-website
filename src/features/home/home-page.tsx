import { Link } from '@tanstack/react-router'
import { useAccess } from '@/app/access'
import { Button } from '@/components/ui/button'
import { useMe } from '@/features/account/use-me'
import { ApplicantPath } from '@/features/applications/applicant-path'
import { useRosterCount } from '@/features/roster/api'

/**
 * Численность состава видна всем ролям, включая гостя и чтеца (HOM-04); список
 * участников на главной не показывается (HOM-07, HOM-11). Без связи с сервером
 * блок не выводится.
 */
function MembersStat() {
  const count = useRosterCount()
  if (count.isError) return null
  return (
    <section
      aria-label="Численность клана"
      className="mt-7 grid max-w-[220px] gap-0.5 rounded-xl border border-border bg-surface-inset/80 px-4 py-3"
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

/** «участник / участника / участников» по правилам русского языка. */
export function membersLabel(count: number) {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return 'участник'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14))
    return 'участника'
  return 'участников'
}

/** Главная страница: приветствие, вход для гостя и путь кандидата (HOM-06). */
export function HomePage() {
  const { status, role } = useAccess()
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
          Готовим общее пространство для участников. Здесь появятся новости,
          встречи и жизнь гильдии.
        </p>
        <MembersStat />
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
    </>
  )
}
