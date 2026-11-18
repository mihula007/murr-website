import { useEffect, useState } from 'react'
import { ArrowDownAZ, ArrowUpAZ, SlidersHorizontal } from 'lucide-react'
import { ACCESS_ROLES } from '@contracts/accounts'
import type { AccessRole } from '@contracts/account'
import type {
  AccountListItem,
  AccountSort,
  SortDirection,
} from '@contracts/accounts'
import { EmptyState } from '@/components/states/empty-state'
import { ErrorState } from '@/components/states/error-state'
import { LoadingState } from '@/components/states/loading-state'
import { Button, linkButtonClass } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { pagingOf } from '@/components/virtual-list'
import { ROLE_LABELS } from '@/app/access'
import { useClasses } from '@/features/catalog/use-classes'
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
  { value: 'registered', label: 'Дата регистрации' },
]

const ROLE_FILTER_OPTIONS = [
  { value: 'all', label: 'Все роли' },
  ...ACCESS_ROLES.map((role) => ({
    value: role,
    label: ROLE_LABELS[role],
  })),
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
  const classes = useClasses()
  const [filtersOpen, setFiltersOpen] = useState(false)
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
        title={
          query.search || query.classId !== null || query.role !== null
            ? 'Ничего не найдено'
            : 'Аккаунтов нет'
        }
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
      <div className="grid gap-3">
        <Button
          type="button"
          variant="secondary"
          className="hidden w-full justify-center max-[900px]:inline-flex"
          aria-expanded={filtersOpen}
          aria-controls="accounts-filters"
          onClick={() => setFiltersOpen((open) => !open)}
        >
          <SlidersHorizontal aria-hidden="true" size={18} />
          Фильтры
        </Button>
        <div
          id="accounts-filters"
          className={`flex flex-wrap items-end gap-3${filtersOpen ? '' : ' max-[900px]:hidden'}`}
        >
          <SearchInput
            id="accounts-search"
            label="Поиск по нику, имени, email и классу"
            value={query.search}
            onChange={(search) => onQueryChange({ ...query, search })}
          />
          <label
            htmlFor="accounts-class-filter"
            className="grid w-[180px] min-w-0 gap-1 text-xs max-[900px]:w-full"
          >
            <span className="text-muted-foreground">Класс</span>
            <Select
              id="accounts-class-filter"
              aria-label="Фильтр по классу"
              value={query.classId === null ? 'all' : String(query.classId)}
              onValueChange={(classId) =>
                onQueryChange({
                  ...query,
                  classId: classId === 'all' ? null : Number(classId),
                })
              }
              options={[
                { value: 'all', label: 'Все классы' },
                ...(classes.data ?? []).map((item) => ({
                  value: String(item.id),
                  label: item.name,
                })),
              ]}
            />
          </label>
          <label
            htmlFor="accounts-role-filter"
            className="grid w-[180px] min-w-0 gap-1 text-xs max-[900px]:w-full"
          >
            <span className="text-muted-foreground">Роль</span>
            <Select
              id="accounts-role-filter"
              aria-label="Фильтр по роли"
              value={query.role ?? 'all'}
              onValueChange={(role) =>
                onQueryChange({
                  ...query,
                  role: role === 'all' ? null : (role as AccessRole),
                })
              }
              options={ROLE_FILTER_OPTIONS}
            />
          </label>
          <div className="grid w-[200px] gap-1 text-xs max-[900px]:w-full">
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
        {classes.isError ? (
          <p className="m-0 text-sm text-destructive" role="alert">
            Не удалось загрузить классы.{' '}
            <button
              type="button"
              className={linkButtonClass}
              onClick={() => void classes.refetch()}
            >
              Повторить
            </button>
          </p>
        ) : null}
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
