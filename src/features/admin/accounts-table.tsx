import { createContext, useContext, useState } from 'react'
import {
  createColumnHelper,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import type { AccountListItem } from '@contracts/accounts'
import type { AccessRole } from '@contracts/account'
import { ROLE_LABELS } from '@/app/access'
import { ConfirmActionDialog } from '@/components/confirm-action-dialog'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/surfaces'
import { toast } from '@/components/ui/toaster'
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
  if (account.isPrimaryAdmin) return 'Основной администратор: роль не меняется'
  if (account.hasActiveApplication) {
    return 'Заявка на рассмотрении: решение — в разделе «Заявки»'
  }
  return null
}

type RoleChange = { account: AccountListItem; role: AccessRole }
const RoleChangeContext = createContext<(change: RoleChange) => void>(
  () => undefined,
)

function RoleCell({ account }: { account: AccountListItem }) {
  const requestChange = useContext(RoleChangeContext)
  const lock = roleLockReason(account)
  const hintId = `role-lock-${account.id}`
  return (
    <div className="grid max-w-[240px] gap-1 max-[760px]:max-w-none">
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
  column.accessor('role', {
    header: 'Роль',
    cell: (info) => <RoleCell account={info.row.original} />,
  }),
  column.accessor('joinedOn', {
    header: 'Дата вступления',
    cell: (info) => formatDate(info.getValue()),
  }),
])

/**
 * Раскладка карточки на узком экране по колонкам: ник — заголовок карточки,
 * имя и дата вступления — в одну строку, email и роль — во всю ширину.
 */
const MOBILE_CELL: Record<string, { cell: string; label: string }> = {
  gameNickname: {
    cell: 'max-[760px]:order-1 max-[760px]:col-span-full max-[760px]:text-base',
    label: 'max-[760px]:hidden',
  },
  displayName: { cell: 'max-[760px]:order-2', label: '' },
  joinedOn: { cell: 'max-[760px]:order-3', label: '' },
  email: { cell: 'max-[760px]:order-4 max-[760px]:col-span-full', label: '' },
  role: { cell: 'max-[760px]:order-5 max-[760px]:col-span-full', label: '' },
}

/**
 * Ячейки таблицы: на узком экране строка становится карточкой, а подпись
 * колонки — видимым текстом в ячейке (без горизонтальной прокрутки на 375 px).
 */
const tableClass =
  'w-full border-collapse text-left text-[13px] max-[760px]:block [&_td]:border-b [&_td]:border-border [&_td]:px-2 [&_td]:py-3 [&_td]:align-middle [&_th]:border-b [&_th]:border-border [&_th]:px-2 [&_th]:py-3 [&_th]:font-semibold [&_th]:text-muted-foreground max-[760px]:[&_tbody]:grid max-[760px]:[&_tbody]:gap-2.5 max-[760px]:[&_thead]:hidden max-[760px]:[&_tr]:grid max-[760px]:[&_tr]:grid-cols-2 max-[760px]:[&_tr]:gap-x-4 max-[760px]:[&_tr]:gap-y-2.5 max-[760px]:[&_tr]:rounded-xl max-[760px]:[&_tr]:border max-[760px]:[&_tr]:border-border max-[760px]:[&_tr]:bg-surface-inset max-[760px]:[&_tr]:p-3.5 max-[760px]:[&_td]:grid max-[760px]:[&_td]:gap-1 max-[760px]:[&_td]:border-0 max-[760px]:[&_td]:p-0'

/** Таблица аккаунтов с выбором роли и подтверждением (ADM-04–06, ADM-08). */
export function AccountsTable({ accounts }: { accounts: AccountListItem[] }) {
  const table = useTable({ features, columns, data: accounts })
  const setRole = useSetRole()
  const userId = useSession().session?.user.id
  const [change, setChange] = useState<RoleChange | null>(null)
  const isSelf = change?.account.id === userId
  const toReader = change?.role === 'reader'

  return (
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
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {row.getAllCells().map((cell) => (
                <td key={cell.id} className={MOBILE_CELL[cell.column.id]?.cell}>
                  <span
                    className={cn(
                      'hidden text-xs text-muted-foreground max-[760px]:block',
                      MOBILE_CELL[cell.column.id]?.label,
                    )}
                  >
                    {String(cell.column.columnDef.header)}
                  </span>
                  <table.FlexRender cell={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <ConfirmActionDialog
        open={change !== null}
        onOpenChange={(open) => {
          if (!open) setChange(null)
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
          if (!change) return
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
  )
}
