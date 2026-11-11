import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  AccountsListResponse,
  RoleChangeResult,
  SetRoleRequest,
} from '@contracts/accounts'
import { meQueryKey } from '@/features/account/use-me'
import { useSession } from '@/features/auth/session'
import { rosterKeys } from '@/features/roster/query-keys'
import { callApi } from '@/lib/supabase/api'
import { accountKeys } from './query-keys'

export function useAccounts() {
  return useQuery({
    queryKey: accountKeys.all,
    queryFn: () => callApi<AccountsListResponse>('accounts/list'),
    select: (data) => data.accounts,
  })
}

/**
 * Смена роли и блокировка (ADM-04, ADM-08). Строка таблицы обновляется из
 * ответа; состав и численность перечитываются. При отказе кеш не меняется —
 * в таблице остаётся прежняя роль (ADM-06).
 */
export function useSetRole() {
  const queryClient = useQueryClient()
  const userId = useSession().session?.user.id
  return useMutation({
    mutationFn: (input: SetRoleRequest) =>
      callApi<RoleChangeResult>('accounts/set-role', input),
    onSuccess: async (result) => {
      queryClient.setQueryData<AccountsListResponse>(
        accountKeys.all,
        (data) =>
          data && {
            accounts: data.accounts.map((account) =>
              account.id === result.userId
                ? { ...account, role: result.role, joinedOn: result.joinedOn }
                : account,
            ),
          },
      )
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: rosterKeys.all }),
        // Администратор сменил роль себе: меню и доступ меняются сразу.
        result.userId === userId
          ? queryClient.invalidateQueries({ queryKey: meQueryKey(userId) })
          : null,
      ])
    },
  })
}
