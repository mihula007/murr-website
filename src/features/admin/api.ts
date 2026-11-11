import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query'
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

/** Аккаунты — большой список: страницы по курсору; поиск (этап 11) — на сервере. */
export function useAccounts() {
  return useInfiniteQuery({
    queryKey: accountKeys.list,
    queryFn: ({ pageParam }) =>
      callApi<AccountsListResponse>('accounts/list', { cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    select: (data) => data.pages.flatMap((page) => page.items),
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
      queryClient.setQueryData<InfiniteData<AccountsListResponse>>(
        accountKeys.list,
        (data) =>
          data && {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              items: page.items.map((account) =>
                account.id === result.userId
                  ? { ...account, role: result.role, joinedOn: result.joinedOn }
                  : account,
              ),
            })),
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
