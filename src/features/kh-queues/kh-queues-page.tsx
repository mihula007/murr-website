import { PackageOpen, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { useAccess } from '@/app/access'
import { ErrorState } from '@/components/states/error-state'
import { LoadingState } from '@/components/states/loading-state'
import { PageHeader } from '@/components/states/page-header'
import { pagingOf } from '@/components/virtual-list'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useSession } from '@/features/auth/session'
import {
  useIssueKhReward,
  useJoinKhQueue,
  useKhQueues,
  useLeaveKhQueue,
  useKhQueueSettings,
  useRemoveKhQueueEntry,
  useSetKhQueueLimit,
  useSetKhQueueRepeat,
} from './api'
import { KhQueueBoard, type KhQueueBoardData } from './kh-queue-board'
import { KhHistoryPanel } from './kh-history-panel'
import { KhManagementPanel } from './kh-management-panel'

export function KhQueuesPage() {
  const { role } = useAccess()
  const session = useSession()
  const queues = useKhQueues()
  const settings = useKhQueueSettings()
  const join = useJoinKhQueue()
  const leave = useLeaveKhQueue()
  const issue = useIssueKhReward()
  const remove = useRemoveKhQueueEntry()
  const repeat = useSetKhQueueRepeat()
  const setLimit = useSetKhQueueLimit()
  const [tab, setTab] = useState('queues')
  const canManage = role === 'admin' || role === 'master'

  if (queues.isPending || settings.isPending) {
    return <LoadingState label="Загружаем очереди КХ…" />
  }
  if (queues.isError || settings.isError || !queues.data || !settings.data) {
    return (
      <ErrorState
        title="Не удалось загрузить очереди КХ"
        onRetry={() => void queues.refetch()}
      />
    )
  }
  const paging = pagingOf(queues)
  const data = queues.data as KhQueueBoardData
  const settingData = settings.data
  const queueBoard = (
    <KhQueueBoard
      queues={data}
      accessRole={role}
      {...(session.session ? { userId: session.session.user.id } : {})}
      paging={paging}
      maxActiveQueues={settingData.maxActiveQueues}
      activeQueueCount={settingData.activeQueueCount}
      onJoin={(queueKey) => join.mutate({ queueKey })}
      onLeave={(queueKey, entryId) => leave.mutate({ queueKey, entryId })}
      onIssue={(queueKey, entryId) => issue.mutate({ queueKey, entryId })}
      onRemove={(queueKey, entryId) => remove.mutate({ queueKey, entryId })}
      onRepeat={(queueKey, entryId, autoRejoin) =>
        repeat.mutate({ queueKey, entryId, autoRejoin })
      }
    />
  )
  return (
    <div className="[overflow-anchor:none] space-y-7">
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
      {join.isError ||
      leave.isError ||
      issue.isError ||
      remove.isError ||
      repeat.isError ||
      setLimit.isError ? (
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
      {canManage ? (
        <Tabs value={tab} onValueChange={setTab}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border">
            <TabsList aria-label="Раздел КХ" className="border-0">
              <TabsTrigger value="queues">Очередь</TabsTrigger>
              <TabsTrigger value="history">История выдачи</TabsTrigger>
            </TabsList>
            <KhManagementPanel
              value={settingData.maxActiveQueues}
              onSave={(maxActiveQueues) => setLimit.mutate({ maxActiveQueues })}
            />
          </div>
          <TabsContent value="queues">{queueBoard}</TabsContent>
          <TabsContent value="history">
            <KhHistoryPanel />
          </TabsContent>
        </Tabs>
      ) : (
        queueBoard
      )}
    </div>
  )
}
