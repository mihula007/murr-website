import {
  AUDIT_CATEGORIES,
  AUDIT_CATEGORY_LABELS,
  type AuditCategory,
  type AuditEntry,
} from '@contracts/audit'
import { ROLE_LABELS } from '@/app/access'
import { EmptyState } from '@/components/states/empty-state'
import { ErrorState } from '@/components/states/error-state'
import { LoadingState } from '@/components/states/loading-state'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/surfaces'
import { pagingOf, VirtualList } from '@/components/virtual-list'
import { formatDateTimeMsk } from '@/lib/format-date'
import { SearchInput } from './accounts-panel'
import { useAuditLog } from './api'
import type { AuditQuery } from './query-keys'

const ALL = 'all'
const CATEGORY_OPTIONS = [
  { value: ALL, label: 'Все разделы' },
  ...AUDIT_CATEGORIES.map((category) => ({
    value: category,
    label: AUDIT_CATEGORY_LABELS[category],
  })),
]

/** Тип объекта аудита по-русски; служебный код в интерфейс не выводится. */
const TARGET_LABELS: Partial<Record<string, string>> = {
  profile: 'аккаунт',
  account: 'аккаунт',
  user: 'аккаунт',
  join_application: 'заявка',
  event: 'ивент',
  event_template: 'шаблон ивента',
  group_template: 'шаблон групп',
  vote: 'голосование',
  publication: 'публикация',
  market_listing: 'объявление',
  broadcast_draft: 'черновик рассылки',
  broadcast_template: 'шаблон рассылки',
}

function roleLabel(role: string | null) {
  return role && role in ROLE_LABELS
    ? ROLE_LABELS[role as keyof typeof ROLE_LABELS]
    : null
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const actor = entry.actor
  return (
    <article className="grid gap-1.5 rounded-xl border border-border bg-surface-inset p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{AUDIT_CATEGORY_LABELS[entry.category] ?? entry.category}</Badge>
        <strong>{entry.summary}</strong>
        <time
          className="ml-auto text-xs text-muted-foreground"
          dateTime={entry.createdAt}
        >
          {formatDateTimeMsk(entry.createdAt)}
        </time>
      </div>
      {entry.target?.nickname || entry.target?.email ? (
        <span className="break-words">
          Объект: {entry.target.nickname ?? '—'}
          {entry.target.email ? ` · ${entry.target.email}` : ''}
        </span>
      ) : entry.target && TARGET_LABELS[entry.target.kind] ? (
        <span className="text-muted-foreground">
          Объект: {TARGET_LABELS[entry.target.kind]}
        </span>
      ) : null}
      {typeof entry.details.title === 'string' ? (
        <span className="break-words text-muted-foreground">
          «{entry.details.title}»
        </span>
      ) : null}
      <span className="break-words text-xs text-muted-foreground">
        {actor
          ? `Исполнитель: ${actor.nickname ?? '—'}${
              roleLabel(actor.role) ? ` (${roleLabel(actor.role)})` : ''
            }${actor.email ? ` · ${actor.email}` : ''}`
          : 'Исполнитель: система'}
      </span>
    </article>
  )
}

/** Вкладка «Журнал»: последние 1000 действий (ADM-10, ADM-12, ADM-13). */
export function AuditPanel({
  query,
  onQueryChange,
}: {
  query: AuditQuery
  onQueryChange: (query: AuditQuery) => void
}) {
  const log = useAuditLog(query)

  let content
  if (log.isPending) {
    content = <LoadingState label="Загружаем журнал…" />
  } else if (log.isError) {
    content = <ErrorState onRetry={() => void log.refetch()} />
  } else if (log.data.length === 0) {
    content = (
      <EmptyState
        title={
          query.search || query.category ? 'Ничего не найдено' : 'Журнал пуст'
        }
      />
    )
  } else {
    content = (
      <VirtualList
        label="Журнал действий"
        items={log.data}
        getKey={(entry) => String(entry.id)}
        estimateSize={110}
        paging={pagingOf(log)}
        renderItem={(entry) => <AuditRow entry={entry} />}
      />
    )
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <SearchInput
          id="audit-search"
          label="Поиск по исполнителю и событию"
          value={query.search}
          onChange={(search) => onQueryChange({ ...query, search })}
        />
        <div className="grid w-[220px] gap-1 text-xs max-xs:w-full">
          <span id="audit-category-label" className="text-muted-foreground">
            Раздел
          </span>
          <Select
            aria-labelledby="audit-category-label"
            value={query.category ?? ALL}
            onValueChange={(value) =>
              onQueryChange({
                ...query,
                category: value === ALL ? null : (value as AuditCategory),
              })
            }
            options={CATEGORY_OPTIONS}
          />
        </div>
      </div>
      <p className="m-0 text-xs text-muted-foreground">
        Хранятся последние 1000 записей; пароли и коды не записываются.
      </p>
      {content}
    </div>
  )
}
