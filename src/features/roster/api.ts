import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import type {
  RestoreReaderRequest,
  RoleChangeResult,
} from '@contracts/accounts'
import type {
  RosterCountResponse,
  RosterListResponse,
  RosterReadersResponse,
  RosterStatsResponse,
} from '@contracts/roster'
import { callApi } from '@/lib/supabase/api'
import { accountKeys } from '@/features/admin/query-keys'
import { rosterKeys } from './query-keys'

/** Численность видна всем; кэш на 5 минут бережёт квоту вызовов Free. */
export function useRosterCount() {
  return useQuery({
    queryKey: rosterKeys.count,
    queryFn: () => callApi<RosterCountResponse>('roster/count'),
    staleTime: 5 * 60_000,
    select: (data) => data.count,
  })
}

/** Численность и распределение по классам — считает сервер (ROS-05). */
export function useRosterStats() {
  return useQuery({
    queryKey: rosterKeys.stats,
    queryFn: () => callApi<RosterStatsResponse>('roster/stats'),
  })
}

/**
 * Весь текущий состав одним ответом (Q-48); фильтр класса — на клиенте,
 * поэтому смена фильтра не делает новый запрос.
 */
export function useRoster() {
  return useQuery({
    queryKey: rosterKeys.list,
    queryFn: () => callApi<RosterListResponse>('roster/list'),
  })
}

/** Чтецы — большой список: страницы по курсору. */
export function useReaders() {
  return useInfiniteQuery({
    queryKey: rosterKeys.readers,
    queryFn: ({ pageParam }) =>
      callApi<RosterReadersResponse>('roster/readers', { cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    select: (data) => data.pages.flatMap((page) => page.items),
  })
}

/** Восстановление чтеца в роли члена (ACL-06): состав и аккаунты перечитываются. */
export function useRestoreReader() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: RestoreReaderRequest) =>
      callApi<RoleChangeResult>('accounts/restore-reader', input),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: rosterKeys.all }),
        queryClient.invalidateQueries({ queryKey: accountKeys.all }),
      ]),
  })
}
