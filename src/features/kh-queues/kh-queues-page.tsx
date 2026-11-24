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
        title="КХ"
        description="Встаньте в конец нужной очереди. Свои записи можно убрать до выдачи награды."
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
