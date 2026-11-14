import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import type { VoteDetails } from '@contracts/votes'
import { MEMBER_LIST_LIMIT } from '@contracts/paging'
import { ErrorState } from '@/components/states/error-state'
import { LoadingState } from '@/components/states/loading-state'
import { PageHeader } from '@/components/states/page-header'
import { linkButtonClass } from '@/components/ui/button'
import { Card } from '@/components/ui/surfaces'
import { cn } from '@/lib/utils'
import { useVote } from './api'
import { VoteCard } from './vote-card'

const sectionTitleClass = 'm-0 font-sans text-base font-bold text-foreground'

/** Кто как голосовал — только офицеру и администратору (VOT-07, Q-16). */
function Ballots({ vote }: { vote: VoteDetails }) {
  const ballots = vote.ballots ?? []
  const labels = new Map(
    vote.options.map((option) => [option.id, option.label]),
  )
  return (
    <Card className="grid gap-3">
      <h2 className={sectionTitleClass}>Кто как голосовал</h2>
      {ballots.length === 0 ? (
        <p className="m-0 text-muted-foreground">Голосов пока нет.</p>
      ) : (
        <ul
          aria-label="Голоса участников"
          className="m-0 grid list-none gap-0 p-0"
        >
          {ballots.map((ballot, index) => (
            <li
              key={`${ballot.gameNickname ?? 'deleted'}-${index}`}
              className="flex min-w-0 items-baseline justify-between gap-3 border-b border-border py-2 last:border-b-0"
            >
              <span className="min-w-0 break-words">
                {ballot.gameNickname ?? (
                  <span className="text-muted-foreground">
                    Пользователь удалён
                  </span>
                )}
              </span>
              <strong className="text-right break-words text-primary">
                {labels.get(ballot.optionId) ?? '—'}
              </strong>
            </li>
          ))}
        </ul>
      )}
      {vote.ballotsTruncated ? (
        <output className="text-sm text-muted-foreground">
          Показаны первые {MEMBER_LIST_LIMIT} голосов по нику. Итоги выше
          учитывают все голоса.
        </output>
      ) : null}
    </Card>
  )
}

/** Страница голосования: карточка, голоса и связанная заявка. */
export function VotePage({ id }: { id: string }) {
  const navigate = useNavigate()
  const vote = useVote(id)

  let content
  if (vote.isPending) {
    content = (
      <>
        <PageHeader title="Голосование" />
        <LoadingState label="Загружаем голосование…" />
      </>
    )
  } else if (vote.isError) {
    content = (
      <>
        <PageHeader title="Голосование" />
        {vote.error.code === 'not_found' ? (
          <ErrorState
            title="Голосование не найдено"
            message="Возможно, его удалили или ссылка устарела."
          />
        ) : (
          <ErrorState onRetry={() => void vote.refetch()} />
        )}
      </>
    )
  } else {
    const data = vote.data
    content = (
      <div className="grid gap-4">
        <VoteCard
          page
          vote={data}
          onDeleted={() =>
            void navigate({ to: '/votes', search: { tab: 'active' } })
          }
        />
        {data.applicationId ? (
          <Link
            to="/applications/$id"
            params={{ id: data.applicationId }}
            className="text-primary underline underline-offset-2"
          >
            Открыть заявку кандидата
          </Link>
        ) : null}
        {data.ballots ? <Ballots vote={data} /> : null}
      </div>
    )
  }

  return (
    <section className="mx-auto w-full max-w-[720px]">
      <Link
        to="/votes"
        search={{ tab: 'active' }}
        className={cn(linkButtonClass, 'mb-3 inline-flex items-center gap-1.5')}
      >
        <ArrowLeft size={16} aria-hidden="true" /> К голосованиям
      </Link>
      {content}
    </section>
  )
}
