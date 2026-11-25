import { useState } from 'react'
import { Card } from '@/components/ui/surfaces'
import { ErrorState } from '@/components/states/error-state'
import { LoadingState } from '@/components/states/loading-state'
import { ScrollableVirtualList } from '@/components/virtual-list'
import { formatDateTimeMsk } from '@/lib/format-date'
import { utcToMoscow } from '@contracts/moscow-time'
import { useKhRewardHistory } from './api'

export function KhHistoryPanel() {
  const [defaultPeriod] = useState(() => {
    const moscowToday = utcToMoscow(new Date()).date
    const to = new Date(`${moscowToday}T12:00:00.000Z`)
    const from = new Date(to)
    from.setUTCDate(from.getUTCDate() - 30)
    return {
      dateFrom: from.toISOString().slice(0, 10),
      dateTo: to.toISOString().slice(0, 10),
    }
  })
  const [dateFrom, setDateFrom] = useState(defaultPeriod.dateFrom)
  const [dateTo, setDateTo] = useState(defaultPeriod.dateTo)
  const history = useKhRewardHistory(dateFrom, dateTo)
  const items = history.data?.items ?? []
  const paging = {
    hasMore: history.hasNextPage,
    loadingMore: history.isFetchingNextPage,
    loadError: history.isFetchNextPageError,
    onLoadMore: () => void history.fetchNextPage(),
  }
  return (
    <Card className="my-4 space-y-4">
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-sm">
          С даты
          <input
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.currentTarget.value)}
            className="min-h-11 rounded-lg border border-input bg-input-background px-3"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          По дату
          <input
            type="date"
            value={dateTo}
            onChange={(event) => setDateTo(event.currentTarget.value)}
            className="min-h-11 rounded-lg border border-input bg-input-background px-3"
          />
        </label>
      </div>
      {dateFrom > dateTo ? (
        <p role="alert" className="text-sm text-destructive">
          Начало периода должно быть раньше конца.
        </p>
      ) : null}
      {history.isPending ? (
        <LoadingState label="Загружаем историю выдачи…" />
      ) : null}
      {history.isError ? (
        <ErrorState
          title="Не удалось загрузить историю выдачи"
          onRetry={() => void history.refetch()}
        />
      ) : null}
      {!history.isPending && !history.isError && items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          За этот период выдач нет.
        </p>
      ) : null}
      {items.length > 0 ? (
        <ScrollableVirtualList
          items={items}
          getKey={(item) => item.id}
          label="История выдачи наград КХ"
          estimateSize={58}
          viewportRows={20}
          paging={paging}
          renderItem={(item) => (
            <article className="flex flex-wrap justify-between gap-2 rounded-lg border border-border/70 bg-surface-inset px-3 py-3 text-sm">
              <span>
                <strong>{item.gameNickname}</strong> — выдана награда «
                {item.rewardName}»
              </span>
              <time dateTime={item.issuedAt}>
                {formatDateTimeMsk(item.issuedAt)}
              </time>
            </article>
          )}
        />
      ) : null}
    </Card>
  )
}
