import { Link } from '@tanstack/react-router'
import { Check } from 'lucide-react'
import type { ApplicationStatus, ApplicationView } from '@contracts/account'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/surfaces'
import { APPLICATION_STATUS } from '@/features/account/status-labels'
import { cn } from '@/lib/utils'

/** Этапы пути кандидата (HOM-06). */
const STEPS = [
  { title: 'Аккаунт', text: 'Аккаунт и анкета созданы' },
  { title: 'Проверка', text: 'Офицер проверяет анкету' },
  { title: 'Голосование', text: 'Клан рассматривает заявку' },
  { title: 'Решение', text: 'Приём в клан или отказ' },
] as const

const ACTIVE_STEP: Record<ApplicationStatus, number> = {
  pending_officer_review: 1,
  pending_vote: 2,
  officer_approved: 3,
  officer_rejected: 3,
  admin_approved: 3,
  admin_rejected: 3,
}

const TITLES: Record<ApplicationStatus, string> = {
  pending_officer_review: 'Заявка отправлена',
  pending_vote: 'Заявка на голосовании',
  officer_approved: 'Заявка принята',
  officer_rejected: 'Заявка отклонена',
  admin_approved: 'Заявка принята',
  admin_rejected: 'Заявка отклонена',
}

const stepClass = {
  done: 'border-live-border [&>strong]:text-live',
  active:
    'border-primary bg-accent text-accent-foreground [&>strong]:text-primary',
  todo: '',
  skipped: 'border-dashed opacity-70',
} as const

/** Прямое решение проходит без голосования. */
const DIRECT_DECISIONS: readonly ApplicationStatus[] = [
  'officer_approved',
  'officer_rejected',
]
const VOTE_STEPS = new Set([2])

type ApplicantPathProps = {
  application: ApplicationView | null
  canResubmit?: boolean | undefined
  className?: string
}

/**
 * Путь кандидата по этапам (HOM-06, APP-06): только собственный статус, без
 * чужих анкет и голосов. После отказа — переход к новой заявке (APP-10).
 */
export function ApplicantPath({
  application,
  canResubmit,
  className,
}: ApplicantPathProps) {
  const status = application?.status
  const active = status ? ACTIVE_STEP[status] : 0
  const title = status ? TITLES[status] : 'Аккаунт создан'
  const description = status
    ? APPLICATION_STATUS[status].notice
    : 'Заявка ещё не подана.'

  return (
    <section aria-labelledby="applicant-path-title" className="@container">
      <Card className={cn('grid gap-4', className)}>
        <div className="grid gap-1.5">
          <p className="text-sm font-semibold text-primary">Путь в клан</p>
          <h2 id="applicant-path-title" className="text-xl font-bold">
            {title}
          </h2>
          <p className="text-muted-foreground" aria-live="polite">
            {description}
          </p>
        </div>
        <ol className="m-0 grid list-none grid-cols-1 gap-2.5 p-0 @md:grid-cols-2 @3xl:grid-cols-4">
          {STEPS.map((step, index) => {
            const skipped =
              status !== undefined &&
              DIRECT_DECISIONS.includes(status) &&
              VOTE_STEPS.has(index)
            const state = skipped
              ? 'skipped'
              : index < active
                ? 'done'
                : index === active
                  ? 'active'
                  : 'todo'
            return (
              <li
                key={step.title}
                aria-current={state === 'active' ? 'step' : undefined}
                className={cn(
                  'grid content-start gap-1.5 rounded-xl border border-border bg-surface-inset p-3 text-xs text-muted-foreground @3xl:min-h-[92px]',
                  stepClass[state],
                )}
              >
                <strong className="inline-flex items-center gap-1 text-sm text-foreground">
                  {state === 'done' ? (
                    <Check size={14} aria-label="Пройдено" />
                  ) : null}
                  {step.title}
                </strong>
                {skipped
                  ? 'Не потребовалось: решение без голосования'
                  : step.text}
              </li>
            )
          })}
        </ol>
        {canResubmit ? (
          <Button asChild className="justify-self-start max-xs:w-full">
            <Link to="/account/application">Подать новую заявку</Link>
          </Button>
        ) : null}
      </Card>
    </section>
  )
}
