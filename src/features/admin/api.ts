import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query'
import type {
  AccountCard,
  AccountsListResponse,
  DeleteAccountRequest,
  DeleteAccountResult,
  PendingDeletionsResponse,
  RoleChangeResult,
  SetPasswordRequest,
  SetPasswordResult,
  SetRoleRequest,
} from '@contracts/accounts'
import type {
  SetCharacterStatRequest,
  SetCharacterStatResult,
} from '@contracts/character-stats'
import type { AuditListResponse } from '@contracts/audit'
import { meQueryKey } from '@/features/account/use-me'
import { useSession } from '@/features/auth/session'
import { rosterKeys } from '@/features/roster/query-keys'
import { callApi } from '@/lib/supabase/api'
import {
  accountKeys,
  auditKeys,
  type AccountsQuery,
  type AuditQuery,
} from './query-keys'

/**
 * Аккаунты — большой список: страницы по курсору, поиск и сортировка — на
 * сервере (ADM-01, ADM-02). Смена параметров начинает список заново.
 */
export function useAccounts(query: AccountsQuery) {
  return useInfiniteQuery({
    queryKey: accountKeys.list(query),
    queryFn: ({ pageParam }) =>
      callApi<AccountsListResponse>('accounts/list', {
        cursor: pageParam,
        search: query.search || null,
        sort: query.sort,
        direction: query.direction,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
    select: (data) => ({
      items: data.pages.flatMap((page) => page.items),
      total: data.pages[0]?.total ?? 0,
    }),
  })
}

/** Раскрытая карточка аккаунта (ADM-03). */
export function useAccountCard(userId: string | null) {
  return useQuery({
    queryKey: accountKeys.card(userId ?? ''),
    queryFn: () => callApi<AccountCard>('accounts/get', { userId }),
    enabled: userId !== null,
  })
}

/**
 * Смена роли и блокировка (ADM-04, ADM-08). Строки таблицы обновляются из
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
      queryClient.setQueriesData<InfiniteData<AccountsListResponse>>(
        { queryKey: accountKeys.lists },
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
        queryClient.invalidateQueries({
          queryKey: accountKeys.card(result.userId),
        }),
        // Администратор сменил роль себе: меню и доступ меняются сразу.
        result.userId === userId
          ? queryClient.invalidateQueries({ queryKey: meQueryKey(userId) })
          : null,
      ])
    },
  })
}

/** Новый пароль другого аккаунта (ADM-07, Q-72); журнал перечитывается. */
export function useSetPassword() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: SetPasswordRequest) =>
      callApi<SetPasswordResult>('accounts/set-password', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: auditKeys.all }),
  })
}

/** Отдельное сохранение одного поля карточки профиля (ADM-15). */
export function useSetCharacterStat() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: SetCharacterStatRequest) =>
      callApi<SetCharacterStatResult>('accounts/set-character-stat', input),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: accountKeys.card(result.userId),
        }),
        queryClient.invalidateQueries({ queryKey: auditKeys.all }),
        queryClient.invalidateQueries({ queryKey: rosterKeys.all }),
      ])
    },
  })
}

/** Незавершённые удаления (Q-74) — малый список. */
export function usePendingDeletions() {
  return useQuery({
    queryKey: accountKeys.deletions,
    queryFn: () => callApi<PendingDeletionsResponse>('accounts/deletions'),
  })
}

/**
 * Безвозвратное удаление или его повтор (ADM-08, Q-73, Q-74). Успех и сбой
 * меняют аккаунты, удаления, состав и журнал — всё перечитывается.
 */
export function useDeleteAccount() {
  const queryClient = useQueryClient()
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: accountKeys.all }),
      queryClient.invalidateQueries({ queryKey: rosterKeys.all }),
      queryClient.invalidateQueries({ queryKey: auditKeys.all }),
    ])
  return useMutation({
    mutationFn: (input: DeleteAccountRequest) =>
      callApi<DeleteAccountResult>('accounts/delete', input),
    onSuccess: refresh,
    onError: refresh,
  })
}

/** Журнал действий (Q-68): курсор, категория и поиск — на сервере. */
export function useAuditLog(query: AuditQuery) {
  return useInfiniteQuery({
    queryKey: auditKeys.list(query),
    queryFn: ({ pageParam }) =>
      callApi<AuditListResponse>('audit/list', {
        cursor: pageParam,
        category: query.category,
        search: query.search || null,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
    select: (data) => data.pages.flatMap((page) => page.items),
  })
}
