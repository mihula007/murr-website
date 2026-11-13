import { createContext, useContext, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import {
  createColumnHelper,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import type { AccountListItem } from '@contracts/accounts'
import type { AccessRole } from '@contracts/account'
import { ROLE_LABELS } from '@/app/access'
import { ConfirmActionDialog } from '@/components/confirm-action-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/surfaces'
import { toast } from '@/components/ui/toaster'
import {
  LoadMore,
  useMediaQuery,
  useWindowList,
  VirtualSpacerRow,
  type Paging,
} from '@/components/virtual-list'
import { APPLICATION_STATUS } from '@/features/account/status-labels'
import { useSession } from '@/features/auth/session'
import { formatDate } from '@/lib/format-date'
import { cn } from '@/lib/utils'
import { useSetRole } from './api'

/** Роли в порядке ADM-04. */
const ROLE_OPTIONS = (
  ['admin', 'officer', 'member', 'reader', 'applicant'] as const
).map((role) => ({ value: role, label: ROLE_LABELS[role] }))

/** Почему роль аккаунта нельзя выбрать здесь; `null` — можно. */
export function roleLockReason(account: AccountListItem) {
  if (account.deletionPending) {
    return 'Идёт удаление аккаунта'
  }
  if (account.isPrimaryAdmin) {
    return 'Основной администратор: роль не меняется'
  }
  if (account.hasActiveApplication) {
    return 'Заявка на рассмотрении: решение — в разделе «Заявки»'
  }
  return null
}

type RoleChange = { account: AccountListItem; role: AccessRole }
const RoleChangeContext = createContext<(change: RoleChange) => void>(
  () => undefined,
)

/** Действие строки: карточка, новый пароль, удаление. */
export type AccountAction = 'card' | 'password' | 'delete'
type ActionHandler = (account: AccountListItem, action: AccountAction) => void
const ActionContext = createContext<{
  selfId: string | undefined
  onAction: ActionHandler
}>({ selfId: undefined, onAction: () => undefined })

/** Пароль меняется не себе и не основному администратору (Q-72). */
export function canChangePassword(account: AccountListItem, selfId?: string) {
  return (
    account.id !== selfId && !account.isPrimaryAdmin && !account.deletionPending
  )
}

/** Удаляется только не-администратор и не сам исполнитель (Q-73). */
export function canDelete(account: AccountListItem, selfId?: string) {
  return account.id !== selfId && account.role !== 'admin'
}

function ActionsCell({ account }: { account: AccountListItem }) {
  const { selfId, onAction } = useContext(ActionContext)
  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => onAction(account, 'card')}
      >
        Карточка
      </Button>
      {canChangePassword(account, selfId) || canDelete(account, selfId) ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-label={`Действия с ${account.gameNickname}`}
            >
              <MoreHorizontal aria-hidden="true" size={18} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canChangePassword(account, selfId) ? (
              <DropdownMenuItem onSelect={() => onAction(account, 'password')}>
                Сменить пароль
              </DropdownMenuItem>
            ) : null}
            {canDelete(account, selfId) ? (
              <DropdownMenuItem
                className="text-destructive data-highlighted:text-destructive"
                onSelect={() => onAction(account, 'delete')}
              >
                {account.deletionPending
                  ? 'Повторить удаление'
                  : 'Удалить навсегда'}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  )
}

function RoleCell({ account }: { account: AccountListItem }) {
  const requestChange = useContext(RoleChangeContext)
  const lock = roleLockReason(account)
  const hintId = `role-lock-${account.id}`
  return (
    <div className="grid max-w-[240px] gap-1 max-[900px]:max-w-none">
      <Select
        aria-label={`Роль ${account.gameNickname}`}
        aria-describedby={lock ? hintId : undefined}
        value={account.role}
        disabled={lock !== null}
        onValueChange={(role) =>
          requestChange({ account, role: role as AccessRole })
        }
        options={ROLE_OPTIONS}
      />
      {lock ? (
        <small id={hintId} className="text-xs text-muted-foreground">
          {lock}
        </small>
      ) : null}
    </div>
  )
}

const features = tableFeatures({})
const column = createColumnHelper<typeof features, AccountListItem>()
const columns = column.columns([
  column.accessor('gameNickname', {
    header: 'Ник',
    cell: (info) => (
      <strong className="break-words text-foreground">{info.getValue()}</strong>
    ),
  }),
  column.accessor('displayName', { header: 'Имя' }),
  column.accessor('email', {
    header: 'Email',
    cell: (info) => <span className="break-all">{info.getValue()}</span>,
  }),
  column.accessor('className', { header: 'Класс' }),
  column.accessor('role', {
    header: 'Роль',
    cell: (info) => <RoleCell account={info.row.original} />,
  }),
  column.accessor('applicationStatus', {
    header: 'Заявка',
    cell: (info) => {
      const status = info.getValue()
      return status ? APPLICATION_STATUS[status].label : '—'
    },
  }),
  column.accessor('joinedOn', {
    header: 'Дата вступления',
    cell: (info) => formatDate(info.getValue()),
  }),
  column.display({
    id: 'actions',
    header: 'Действия',
    cell: (info) => <ActionsCell account={info.row.original} />,
  }),
])

/**
 * Раскладка карточки на узком экране по колонкам: ник — заголовок карточки,
 * имя и дата вступления — в одну строку, email и роль — во всю ширину.
 */
const MOBILE_CELL: Record<string, { cell: string; label: string }> = {
  gameNickname: {
    cell: 'max-[900px]:order-1 max-[900px]:col-span-full max-[900px]:text-base',
    label: 'max-[900px]:hidden',
  },
  displayName: { cell: 'max-[900px]:order-2', label: '' },
  className: { cell: 'max-[900px]:order-3', label: '' },
  applicationStatus: { cell: 'max-[900px]:order-4', label: '' },
  joinedOn: { cell: 'max-[900px]:order-5', label: '' },
  email: { cell: 'max-[900px]:order-6 max-[900px]:col-span-full', label: '' },
  role: { cell: 'max-[900px]:order-7 max-[900px]:col-span-full', label: '' },
  actions: {
    cell: 'max-[900px]:order-8 max-[900px]:col-span-full',
    label: 'max-[900px]:hidden',
  },
}

/**
 * Ячейки таблицы: на узком экране строка становится карточкой, а подпись
 * колонки — видимым текстом в ячейке (без горизонтальной прокрутки на 375 px).
 */
const tableClass =
  'w-full border-collapse text-left text-[13px] max-[900px]:block [&_td]:border-b [&_td]:border-border [&_td]:px-2 [&_td]:py-3 [&_td]:align-middle [&_th]:border-b [&_th]:border-border [&_th]:px-2 [&_th]:py-3 [&_th]:font-semibold [&_th]:text-muted-foreground max-[900px]:[&_tbody]:grid max-[900px]:[&_tbody]:gap-2.5 max-[900px]:[&_thead]:hidden max-[900px]:[&_tr]:grid max-[900px]:[&_tr]:grid-cols-2 max-[900px]:[&_tr]:gap-x-4 max-[900px]:[&_tr]:gap-y-2.5 max-[900px]:[&_tr]:rounded-xl max-[900px]:[&_tr]:border max-[900px]:[&_tr]:border-border max-[900px]:[&_tr]:bg-surface-inset max-[900px]:[&_tr]:p-3.5 max-[900px]:[&_td]:grid max-[900px]:[&_td]:gap-1 max-[900px]:[&_td]:border-0 max-[900px]:[&_td]:p-0'

/** Промежуток между карточками строк на узком экране (`gap-2.5`), px. */
const NARROW_GAP = 10

/**
 * Таблица аккаунтов с выбором роли и подтверждением (ADM-04–06, ADM-08).
 * Большой список: страницы по курсору, строки виртуализированы.
 */
export function AccountsTable({
  accounts,
  paging,
  onAction,
}: {
  accounts: AccountListItem[]
  paging: Paging
  onAction: ActionHandler
}) {
  const table = useTable({ features, columns, data: accounts })
  const rows = table.getRowModel().rows
  const narrow = useMediaQuery('(max-width: 900px)')
  const {
    setListElement,
    items: virtualItems,
    measureElement,
    before,
    after,
  } = useWindowList({
    count: rows.length,
    estimateSize: narrow ? 300 : 64,
    gap: narrow ? NARROW_GAP : 0,
    getItemKey: (index) => rows[index]?.id ?? String(index),
    paging,
  })
  // Отступ-строка в сетке узкого экрана сама добавляет промежуток.
  const spacer = (height: number) => (narrow ? height - NARROW_GAP : height)
  const setRole = useSetRole()
  const userId = useSession().session?.user.id
  const [change, setChange] = useState<RoleChange | null>(null)
  const isSelf = change?.account.id === userId
  const toReader = change?.role === 'reader'

  return (
    <ActionContext.Provider value={{ selfId: userId, onAction }}>
      <RoleChangeContext.Provider value={setChange}>
        <table className={tableClass}>
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => (
                  <th key={header.id} scope="col">
                    {header.isPlaceholder ? null : (
                      <table.FlexRender header={header} />
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody ref={setListElement}>
            <VirtualSpacerRow
              height={spacer(before)}
              colSpan={columns.length}
            />
            {virtualItems.map((item) => {
              const row = rows[item.index]
              if (!row) {
                return null
              }
              return (
                <tr key={row.id} data-index={item.index} ref={measureElement}>
                  {row.getAllCells().map((cell) => (
                    <td
                      key={cell.id}
                      className={MOBILE_CELL[cell.column.id]?.cell}
                    >
                      <span
                        className={cn(
                          'hidden text-xs text-muted-foreground max-[900px]:block',
                          MOBILE_CELL[cell.column.id]?.label,
                        )}
                      >
                        {String(cell.column.columnDef.header)}
                      </span>
                      <table.FlexRender cell={cell} />
                    </td>
                  ))}
                </tr>
              )
            })}
            <VirtualSpacerRow height={spacer(after)} colSpan={columns.length} />
          </tbody>
        </table>
        <LoadMore paging={paging} />
        <ConfirmActionDialog
          open={change !== null}
          onOpenChange={(open) => {
            if (!open) {
              setChange(null)
            }
          }}
          title={
            change
              ? toReader
                ? `Заблокировать ${change.account.gameNickname}?`
                : `Сменить роль ${change.account.gameNickname}?`
              : ''
          }
          description={
            change ? (
              <>
                {ROLE_LABELS[change.account.role]} →{' '}
                <Badge>{ROLE_LABELS[change.role]}</Badge>
                {toReader
                  ? ' Пользователь выйдет из состава и сохранит доступ только к своему профилю.'
                  : null}
                {isSelf
                  ? ' Это ваш аккаунт: доступ изменится сразу после подтверждения.'
                  : null}
              </>
            ) : null
          }
          confirmLabel={toReader ? 'Заблокировать' : 'Сменить роль'}
          pendingLabel="Сохраняем…"
          onConfirm={async () => {
            if (!change) {
              return
            }
            await setRole.mutateAsync({
              userId: change.account.id,
              role: change.role,
            })
            toast(
              `${change.account.gameNickname}: ${ROLE_LABELS[change.role].toLowerCase()}`,
            )
          }}
        />
      </RoleChangeContext.Provider>
    </ActionContext.Provider>
  )
}
