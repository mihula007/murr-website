import { PackageOpen, Sparkles } from 'lucide-react'
import { useAccess } from '@/app/access'
import { ErrorState } from '@/components/states/error-state'
import { LoadingState } from '@/components/states/loading-state'
import { PageHeader } from '@/components/states/page-header'
import { pagingOf } from '@/components/virtual-list'
import { useSession } from '@/features/auth/session'
import {
  useIssueKhReward,
  useJoinKhQueue,
  useKhQueues,
  useLeaveKhQueue,
} from './api'
import { KhQueueBoard, type KhQueueBoardData } from './kh-queue-board'

export function KhQueuesPage() {
  const { role } = useAccess()
  const session = useSession()
  const queues = useKhQueues()
  const join = useJoinKhQueue()
  const leave = useLeaveKhQueue()
  const issue = useIssueKhReward()

  if (queues.isPending) {
    return <LoadingState label="Загружаем очереди КХ…" />
  }
  if (queues.isError || !queues.data) {
    return (
      <ErrorState
        title="Не удалось загрузить очереди КХ"
        onRetry={() => void queues.refetch()}
      />
    )
  }
  const paging = pagingOf(queues)
  const data = queues.data as KhQueueBoardData
  return (
    <div className="space-y-7">
      <PageHeader
        title={
          <span className="group/kh-hero flex items-center gap-3">
            <span className="relative grid size-14 shrink-0 place-items-center rounded-2xl border border-primary/60 bg-linear-145/srgb from-primary/20 to-surface-to text-highlight shadow-lg transition-[transform,box-shadow] duration-300 group-hover/kh-hero:-translate-y-1 group-hover/kh-hero:rotate-3 group-hover/kh-hero:shadow-xl motion-reduce:transition-none">
              <PackageOpen
                aria-hidden="true"
                className="size-8 drop-shadow-sm"
              />
              <Sparkles
                aria-hidden="true"
                className="absolute -top-1 -right-1 size-5 animate-pulse text-highlight drop-shadow-glow motion-reduce:animate-none"
              />
            </span>
            <span>Очередь наград КХ</span>
          </span>
        }
        description="Нажмите на свободный слот, чтобы встать в очередь на награду. Свою запись можно убрать до выдачи."
      />
      {join.isError || leave.isError || issue.isError ? (
        <ErrorState
          title="Не удалось обновить очередь"
          message="Изменение не сохранено. Обновите список и попробуйте ещё раз."
          onRetry={() => void queues.refetch()}
        />
      ) : null}
      {paging.loadError ? (
        <ErrorState
          title="Не удалось загрузить продолжение очереди"
          onRetry={paging.onLoadMore}
        />
      ) : null}
      <KhQueueBoard
        queues={data}
        accessRole={role}
        {...(session.session ? { userId: session.session.user.id } : {})}
        paging={paging}
        onJoin={(queueKey) => join.mutate({ queueKey })}
        onLeave={(queueKey, entryId) => leave.mutate({ queueKey, entryId })}
        onIssue={(queueKey, entryId) => issue.mutate({ queueKey, entryId })}
      />
    </div>
  )
}
