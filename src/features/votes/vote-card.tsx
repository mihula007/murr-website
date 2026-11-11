import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Check, ChevronRight, Crown } from 'lucide-react'
import type { VoteDetails, VoteOptionResult } from '@contracts/votes'
import { hasRole, MANAGER_ROLES, useAccess } from '@/app/access'
import { ConfirmActionDialog } from '@/components/confirm-action-dialog'
import { Button } from '@/components/ui/button'
import { Badge, Card, Notice } from '@/components/ui/surfaces'
import { toast } from '@/components/ui/toaster'
import { errorMessage, type AppError } from '@/lib/errors'
import { formatDate } from '@/lib/format-date'
import { cn } from '@/lib/utils'
import { useCastBallot, useCloseVote, useDeleteVote } from './api'
import { EditVoteDialog } from './edit-vote-dialog'
import { voteKeys } from './query-keys'

/** Карточка в списке получает итоги без голосов; карточка-страница — все поля. */
export type VoteCardData = Omit<VoteDetails, 'ballots' | 'ballotsTruncated'>

/**
 * Цвета фиксированных вариантов голосования по заявке, как в прототипе
 * (`.vote-choice-yes` и т. д.): «За» — успех, «Против» — опасность.
 */
const APPLICATION_OPTION_CLASS: Record<string, string> = {
  За: 'border-success-border text-success-foreground',
  Против: 'border-destructive text-destructive',
}

/** Полоса доли голосов: нативный `<progress>`, без inline-стилей. */
const progressClass =
  'h-1.5 w-full appearance-none overflow-hidden rounded-full bg-secondary [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-secondary [&::-webkit-progress-value]:bg-primary'

function Results({
  options,
  total,
  myOptionId,
}: {
  options: VoteOptionResult[]
  total: number
  myOptionId: string | null
}) {
  return (
    <ul aria-label="Итоги" className="m-0 grid list-none gap-2.5 p-0">
      {options.map((option) => (
        <li key={option.id} className="grid gap-1">
          <div className="flex min-w-0 items-baseline gap-2 text-sm">
            <span
              className={cn(
                'min-w-0 flex-1 break-words',
                option.leading && 'font-bold text-primary',
              )}
            >
              {option.label}
              {option.leading ? (
                <Crown
                  size={14}
                  aria-label="Лидирует"
                  className="ml-1.5 inline align-[-2px]"
                />
              ) : null}
              {option.id === myOptionId ? (
                <span className="ml-2 text-xs text-muted-foreground">
                  ваш выбор
                </span>
              ) : null}
            </span>
            <strong className="text-foreground tabular-nums">
              {option.count}
            </strong>
          </div>
          <progress
            className={progressClass}
            value={option.count}
            max={Math.max(total, 1)}
            aria-label={`${option.label}: ${option.count} из ${total}`}
          />
        </li>
      ))}
    </ul>
  )
}

/**
 * Выбор варианта (VOT-05, VOT-06). «Изменить решение» открывает варианты, а
 * прежний голос остаётся в силе до нового выбора.
 */
function Ballot({ vote }: { vote: VoteCardData }) {
  const queryClient = useQueryClient()
  const cast = useCastBallot()
  const [changing, setChanging] = useState(false)
  const mine = vote.options.find((option) => option.id === vote.myOptionId)

  async function choose(optionId: string) {
    try {
      await cast.mutateAsync({ voteId: vote.id, optionId })
      setChanging(false)
      toast(mine ? 'Решение изменено' : 'Голос учтён')
    } catch (error) {
      const { code } = error as AppError
      if (code === 'state_conflict' || code === 'not_found') {
        toast(
          code === 'state_conflict'
            ? 'Голосование уже завершено'
            : 'Голосование удалено',
        )
        await queryClient.invalidateQueries({ queryKey: voteKeys.all })
        return
      }
      toast(errorMessage(code))
    }
  }

  if (mine && !changing) {
    return (
      <div className="grid gap-2">
        <p className="m-0 text-sm">
          Ваше решение: <strong className="text-primary">{mine.label}</strong>
        </p>
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          onClick={() => setChanging(true)}
        >
          Изменить решение
        </Button>
      </div>
    )
  }

  return (
    <fieldset className="m-0 grid gap-2 border-0 p-0">
      <legend className="mb-2 text-sm font-semibold">
        {mine ? 'Выберите новое решение' : 'Ваше решение'}
      </legend>
      <div className="grid grid-cols-2 gap-2 max-xs:grid-cols-1">
        {vote.options.map((option) => (
          <Button
            key={option.id}
            type="button"
            variant="secondary"
            disabled={cast.isPending}
            aria-pressed={option.id === vote.myOptionId}
            className={cn(
              'min-w-0 break-words whitespace-normal',
              vote.kind === 'application' &&
                APPLICATION_OPTION_CLASS[option.label],
            )}
            onClick={() => void choose(option.id)}
          >
            {option.id === vote.myOptionId ? (
              <Check size={16} aria-hidden="true" />
            ) : null}
            {option.label}
          </Button>
        ))}
      </div>
      {mine ? (
        <Button
          type="button"
          variant="ghost"
          disabled={cast.isPending}
          onClick={() => setChanging(false)}
        >
          Оставить «{mine.label}»
        </Button>
      ) : null}
    </fieldset>
  )
}

type Pending = 'edit' | 'close' | 'delete' | null

function Management({
  vote,
  onDeleted,
}: {
  vote: VoteCardData
  onDeleted?: (() => void) | undefined
}) {
  const [pending, setPending] = useState<Pending>(null)
  const close = useCloseVote()
  const remove = useDeleteVote()
  const linked = vote.kind === 'application'

  return (
    <>
      <div className="grid grid-cols-3 gap-2 border-t border-border pt-3 max-xs:grid-cols-1">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setPending('edit')}
        >
          Изменить
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setPending('close')}
        >
          Завершить
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="text-destructive"
          onClick={() => setPending('delete')}
        >
          Удалить
        </Button>
      </div>
      <EditVoteDialog
        key={`${vote.id}-${pending === 'edit'}`}
        vote={vote}
        open={pending === 'edit'}
        onOpenChange={(open) => setPending(open ? 'edit' : null)}
      />
      <ConfirmActionDialog
        open={pending === 'close'}
        onOpenChange={(open) => setPending(open ? 'close' : null)}
        title={`Завершить «${vote.title}»?`}
        description={
          linked
            ? 'Голосовать и менять решение станет нельзя. Заявка перейдёт к окончательному решению администратора — итог голосования сам кандидата не принимает.'
            : 'Голосовать и менять решение станет нельзя, голосование перейдёт в историю.'
        }
        confirmLabel="Завершить"
        pendingLabel="Завершаем…"
        onConfirm={async () => {
          await close.mutateAsync(vote.id)
          toast('Голосование завершено')
        }}
      />
      <ConfirmActionDialog
        open={pending === 'delete'}
        onOpenChange={(open) => setPending(open ? 'delete' : null)}
        title={`Удалить «${vote.title}»?`}
        description={
          linked
            ? 'Голосование и все голоса будут удалены. Заявка вернётся в очередь новых заявок.'
            : 'Голосование и все голоса будут удалены без возможности восстановления.'
        }
        confirmLabel="Удалить"
        pendingLabel="Удаляем…"
        onConfirm={async () => {
          await remove.mutateAsync({
            id: vote.id,
            applicationId: vote.applicationId,
          })
          toast('Голосование удалено')
          onDeleted?.()
        }}
      />
    </>
  )
}

type VoteCardProps = {
  vote: VoteCardData
  /** В списке тема ведёт на страницу голосования. */
  linkToPage?: boolean
  onDeleted?: () => void
  className?: string
}

/** Карточка голосования по образцу `.vote-card` прототипа (VOT-01). */
export function VoteCard({
  vote,
  linkToPage = false,
  onDeleted,
  className,
}: VoteCardProps) {
  const { role } = useAccess()
  const isManager = hasRole(role, MANAGER_ROLES)
  const isActive = vote.closedAt === null

  return (
    <Card className={cn('grid min-w-0 gap-4', className)}>
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{vote.kind === 'application' ? 'По заявке' : 'Обычное'}</Badge>
          {isActive ? null : (
            <Badge className="border-border text-muted-foreground">
              Завершено {formatDate(vote.closedAt)}
            </Badge>
          )}
        </div>
        <h2 className="m-0 text-lg leading-snug font-bold break-words">
          {linkToPage ? (
            <Link
              to="/votes/$id"
              params={{ id: vote.id }}
              className="inline-flex max-w-full items-start gap-1 text-foreground no-underline hover:text-primary"
            >
              <span className="min-w-0 break-words">{vote.title}</span>
              <ChevronRight
                size={18}
                aria-hidden="true"
                className="mt-0.5 flex-none text-muted-foreground"
              />
            </Link>
          ) : (
            vote.title
          )}
        </h2>
        {vote.applicant ? (
          <p className="m-0 text-sm text-muted-foreground">
            Кандидат: {vote.applicant.gameNickname} · {vote.applicant.className}
          </p>
        ) : null}
        {vote.context ? (
          <p className="m-0 break-words whitespace-pre-line text-muted-foreground">
            {vote.context}
          </p>
        ) : null}
      </div>

      <Results
        options={vote.options}
        total={vote.totalBallots}
        myOptionId={vote.myOptionId}
      />
      <p className="m-0 text-xs text-muted-foreground">
        Голосов: {vote.totalBallots} · создано {formatDate(vote.createdAt)}
        {vote.createdBy ? ` · ${vote.createdBy.gameNickname}` : ''}
      </p>

      {isActive ? (
        <Ballot vote={vote} />
      ) : (
        <Notice>Голосование завершено: решение изменить нельзя.</Notice>
      )}

      {isActive && isManager ? (
        <Management vote={vote} onDeleted={onDeleted} />
      ) : null}
    </Card>
  )
}
