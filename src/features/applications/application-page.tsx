import { useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import type {
  ApplicationDetails,
  ApplicationVoteResult,
} from '@contracts/applications'
import { ADMIN_ROLES, hasRole, useAccess } from '@/app/access'
import { ConfirmActionDialog } from '@/components/confirm-action-dialog'
import { ErrorState } from '@/components/states/error-state'
import { LoadingState } from '@/components/states/loading-state'
import { PageHeader } from '@/components/states/page-header'
import { Avatar } from '@/components/ui/avatar'
import { Button, linkButtonClass } from '@/components/ui/button'
import { Badge, Card, Notice } from '@/components/ui/surfaces'
import { toast } from '@/components/ui/toaster'
import { APPLICATION_STATUS } from '@/features/account/status-labels'
import { formatDate } from '@/lib/format-date'
import { cn } from '@/lib/utils'
import { useApplication, useSubmitToVote, type DecisionKind } from './api'
import { DecisionDialog, type Decision } from './decision-dialog'

const detailsListClass =
  'm-0 grid grid-cols-2 gap-x-[18px] gap-y-2 max-[560px]:grid-cols-1 [&_dd]:m-0 [&_dd]:break-words [&_dt]:text-xs [&_dt]:text-muted-foreground'

const sectionTitleClass =
  'text-xs font-extrabold tracking-[0.16em] text-primary uppercase'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-2 border-t border-border pt-4">
      <h2 className={sectionTitleClass}>{title}</h2>
      {children}
    </section>
  )
}

/** Итоги связанного голосования в карточке заявки (APP-08). */
function VoteResult({ vote }: { vote: ApplicationVoteResult }) {
  return (
    <Section title="Голосование">
      <dl className={detailsListClass}>
        {vote.options.map((option) => (
          <div key={option.id}>
            <dt>{option.label}</dt>
            <dd
              className={cn(
                'tabular-nums',
                option.leading && 'font-bold text-primary',
              )}
            >
              {option.count}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-muted-foreground">
        Голосов: {vote.totalBallots} ·{' '}
        {vote.closedAt
          ? `завершено ${formatDate(vote.closedAt)}`
          : 'голосование идёт'}
      </p>
      <Link
        to="/votes/$id"
        params={{ id: vote.id }}
        className="justify-self-start text-primary underline underline-offset-2"
      >
        Открыть голосование
      </Link>
    </Section>
  )
}

/** Пояснение для проверяющих, пока заявка в голосовании или ждёт решения. */
const REVIEWER_NOTICE = {
  pending_vote:
    'Заявка на голосовании. После его завершения окончательное решение примет администратор.',
  vote_completed:
    'Голосование завершено. Окончательное решение принимает администратор.',
} as const

function ApplicationCard({ details }: { details: ApplicationDetails }) {
  const { role } = useAccess()
  const [decision, setDecision] = useState<Decision | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [conflict, setConflict] = useState(false)
  const submitToVote = useSubmitToVote()
  const { applicant } = details
  const isNew = details.status === 'pending_officer_review'
  const awaitsFinal =
    details.status === 'vote_completed' && hasRole(role, ADMIN_ROLES)
  const decisionKind: DecisionKind = awaitsFinal ? 'final' : 'direct'
  const reviewerNotice =
    details.status === 'pending_vote' || details.status === 'vote_completed'
      ? REVIEWER_NOTICE[details.status]
      : null

  return (
    <Card className="mx-auto grid w-full max-w-[720px] gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3.5">
          <Avatar
            size="md"
            name={applicant.gameNickname}
            src={applicant.avatarUrl}
            alt={`Аватар ${applicant.gameNickname}`}
          />
          <div className="min-w-0">
            <h2 className="text-2xl font-bold break-words">
              {applicant.gameNickname}
            </h2>
            <p className="text-muted-foreground">{applicant.className}</p>
          </div>
        </div>
        <Badge>{APPLICATION_STATUS[details.status].label}</Badge>
      </div>

      <dl className={detailsListClass}>
        <div>
          <dt>Имя</dt>
          <dd>{applicant.displayName}</dd>
        </div>
        <div>
          <dt>Подана</dt>
          <dd>{formatDate(details.submittedAt)}</dd>
        </div>
      </dl>

      {details.contacts ? (
        <Section title="Личные данные">
          <dl className={detailsListClass}>
            <div>
              <dt>Электронная почта</dt>
              <dd>{details.contacts.email}</dd>
            </div>
            <div>
              <dt>Город</dt>
              <dd>{details.contacts.city ?? '—'}</dd>
            </div>
            <div>
              <dt>Дата рождения</dt>
              <dd>{formatDate(details.contacts.birthDate)}</dd>
            </div>
          </dl>
        </Section>
      ) : null}

      <Section title="О себе">
        <p className="break-words whitespace-pre-line">
          {applicant.about ?? '—'}
        </p>
      </Section>

      <Section title="Скриншоты снаряжения">
        {details.equipmentLinks.length > 0 ? (
          <ol className="m-0 grid gap-1.5 pl-5">
            {details.equipmentLinks.map((url, index) => (
              <li key={`${index}-${url}`} className="min-w-0">
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex max-w-full items-center gap-1.5 break-all text-primary underline-offset-2 hover:underline"
                >
                  {url}
                  <ExternalLink
                    size={14}
                    aria-hidden="true"
                    className="flex-none"
                  />
                </a>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-muted-foreground">Ссылки не указаны.</p>
        )}
      </Section>

      {details.vote ? <VoteResult vote={details.vote} /> : null}

      {details.decidedAt ? (
        <Section title="Решение">
          <dl className={detailsListClass}>
            <div>
              <dt>Дата решения</dt>
              <dd>{formatDate(details.decidedAt)}</dd>
            </div>
            <div>
              <dt>Решил</dt>
              <dd>{details.decidedBy?.gameNickname ?? '—'}</dd>
            </div>
            {details.decisionNote ? (
              <div className="col-span-full">
                <dt>Примечание</dt>
                <dd className="whitespace-pre-line">{details.decisionNote}</dd>
              </div>
            ) : null}
          </dl>
        </Section>
      ) : null}

      {conflict ? (
        <Notice role="alert">
          Заявка уже рассмотрена: решение принял другой офицер или
          администратор.
        </Notice>
      ) : null}

      {isNew || awaitsFinal ? (
        <div className="flex flex-wrap gap-2 border-t border-border pt-4 max-xs:grid max-xs:grid-cols-1">
          {isNew ? (
            <Button type="button" onClick={() => setSubmitting(true)}>
              Передать на голосование
            </Button>
          ) : null}
          <Button
            type="button"
            variant={isNew ? 'secondary' : 'default'}
            onClick={() => setDecision('accept')}
          >
            Принять
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="text-destructive"
            onClick={() => setDecision('reject')}
          >
            Отклонить
          </Button>
        </div>
      ) : reviewerNotice ? (
        <Notice>{reviewerNotice}</Notice>
      ) : null}

      <ConfirmActionDialog
        open={submitting}
        onOpenChange={setSubmitting}
        title={`Передать заявку ${applicant.gameNickname} на голосование?`}
        description="Будет создано голосование «За», «Против», «Воздержаться», «Конфликт». Участники увидят только ник и класс кандидата. Заявка покинет очередь новых."
        confirmLabel="Передать"
        pendingLabel="Передаём…"
        onConfirm={async () => {
          await submitToVote.mutateAsync(details.id)
          toast('Заявка передана на голосование')
        }}
      />

      <DecisionDialog
        applicationId={details.id}
        nickname={applicant.gameNickname}
        decision={decision}
        kind={decisionKind}
        onClose={() => setDecision(null)}
        onConflict={() => setConflict(true)}
      />
    </Card>
  )
}

/** Карточка заявки: набор полей определяет сервер по роли (APP-03, ACL-10). */
export function ApplicationPage({ id }: { id: string }) {
  const application = useApplication(id)

  let content
  if (application.isPending) {
    content = <LoadingState label="Загружаем заявку…" />
  } else if (application.isError) {
    content =
      application.error.code === 'not_found' ? (
        <ErrorState
          title="Заявка не найдена"
          message="Возможно, ссылка устарела."
        />
      ) : (
        <ErrorState onRetry={() => void application.refetch()} />
      )
  } else {
    content = <ApplicationCard details={application.data} />
  }

  return (
    <section>
      <Link
        to="/applications"
        search={{ tab: 'new' }}
        className={cn(linkButtonClass, 'mb-3 inline-flex items-center gap-1.5')}
      >
        <ArrowLeft size={16} aria-hidden="true" /> К заявкам
      </Link>
      <PageHeader eyebrow="Управление" title="Заявка" />
      {content}
    </section>
  )
}
