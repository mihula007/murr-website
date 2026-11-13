import { useEffect, useState } from 'react'
import { ArrowDownAZ, ArrowUpAZ } from 'lucide-react'
import type {
  AccountListItem,
  AccountSort,
  SortDirection,
} from '@contracts/accounts'
import { EmptyState } from '@/components/states/empty-state'
import { ErrorState } from '@/components/states/error-state'
import { LoadingState } from '@/components/states/loading-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { pagingOf } from '@/components/virtual-list'
import {
  AccountCardDialog,
  DeleteAccountDialog,
  PasswordDialog,
} from './account-dialogs'
import { AccountsTable, type AccountAction } from './accounts-table'
import { useAccounts } from './api'
import { PendingDeletions } from './pending-deletions'
import type { AccountsQuery } from './query-keys'

const SORT_OPTIONS: { value: AccountSort; label: string }[] = [
  { value: 'nickname', label: 'Ник' },
  { value: 'name', label: 'Имя' },
  { value: 'class', label: 'Класс' },
  { value: 'email', label: 'Email' },
  { value: 'role', label: 'Роль' },
  { value: 'registered', label: 'Регистрация' },
  { value: 'joined', label: 'Вступление' },
]

/** Задержка поиска: запрос уходит, когда администратор перестал печатать. */
const SEARCH_DELAY_MS = 300

/** Поле поиска, отправляющее значение после паузы. */
export function SearchInput({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)
  // Значение сменилось извне (назад, ссылка): поле показывает его.
  const [external, setExternal] = useState(value)
  if (value !== external) {
    setExternal(value)
    setDraft(value)
  }
  useEffect(() => {
    if (draft === value) {
      return
    }
    const timer = window.setTimeout(() => onChange(draft), SEARCH_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [draft, value, onChange])
  return (
    <label htmlFor={id} className="grid min-w-0 flex-1 gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <Input
        id={id}
        type="search"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    </label>
  )
}

/** Вкладка «Аккаунты»: поиск, сортировка, таблица и действия (ADM-01–09). */
export function AccountsPanel({
  query,
  onQueryChange,
}: {
  query: AccountsQuery
  onQueryChange: (query: AccountsQuery) => void
}) {
  const accounts = useAccounts(query)
  const [selected, setSelected] = useState<{
    account: AccountListItem
    action: AccountAction
  } | null>(null)
  const close = (open: boolean) => {
    if (!open) {
      setSelected(null)
    }
  }
  const pick = (action: AccountAction) =>
    selected?.action === action ? selected.account : null
  const Direction = query.direction === 'asc' ? ArrowDownAZ : ArrowUpAZ

  let content
  if (accounts.isPending) {
    content = <LoadingState label="Загружаем аккаунты…" />
  } else if (accounts.isError) {
    content = <ErrorState onRetry={() => void accounts.refetch()} />
  } else if (accounts.data.items.length === 0) {
    content = (
      <EmptyState
        title={query.search ? 'Ничего не найдено' : 'Аккаунтов нет'}
      />
    )
  } else {
    content = (
      <AccountsTable
        accounts={accounts.data.items}
        paging={pagingOf(accounts)}
        onAction={(account, action) => setSelected({ account, action })}
      />
    )
  }

  return (
    <div className="grid gap-4">
      <PendingDeletions />
      <div className="flex flex-wrap items-end gap-3">
        <SearchInput
          id="accounts-search"
          label="Поиск по нику, имени, email и классу"
          value={query.search}
          onChange={(search) => onQueryChange({ ...query, search })}
        />
        <div className="grid w-[200px] gap-1 text-xs max-xs:w-full">
          <span id="accounts-sort-label" className="text-muted-foreground">
            Сортировка
          </span>
          <div className="flex gap-2">
            <Select
              aria-labelledby="accounts-sort-label"
              value={query.sort}
              onValueChange={(sort) =>
                onQueryChange({ ...query, sort: sort as AccountSort })
              }
              options={SORT_OPTIONS}
            />
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="flex-none"
              aria-label={
                query.direction === 'asc'
                  ? 'По возрастанию — сменить на убывание'
                  : 'По убыванию — сменить на возрастание'
              }
              onClick={() =>
                onQueryChange({
                  ...query,
                  direction: (query.direction === 'asc'
                    ? 'desc'
                    : 'asc') as SortDirection,
                })
              }
            >
              <Direction aria-hidden="true" size={18} />
            </Button>
          </div>
        </div>
      </div>
      {accounts.data ? (
        <p className="m-0 text-sm text-muted-foreground" aria-live="polite">
          Аккаунтов: {accounts.data.total}
        </p>
      ) : null}
      {content}
      <AccountCardDialog account={pick('card')} onOpenChange={close} />
      <PasswordDialog account={pick('password')} onOpenChange={close} />
      <DeleteAccountDialog account={pick('delete')} onOpenChange={close} />
    </div>
  )
}
