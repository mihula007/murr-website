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
  RosterPageRequest,
  RosterPageResponse,
  RosterReadersResponse,
  RosterStatsResponse,
} from '@contracts/roster'
import { callApi } from '@/lib/supabase/api'
import { accountKeys, auditKeys } from '@/features/admin/query-keys'
import { notificationKeys } from '@/features/notifications/query-keys'
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

/** Состав страницы участников с фильтрами на сервере (ROS-14). */
export function useRosterPages(filters: {
  classId?: number
  search: string
}) {
  const normalized = { ...filters, search: filters.search.trim() }
  return useInfiniteQuery({
    queryKey: rosterKeys.page(normalized),
    queryFn: ({ pageParam }) =>
      callApi<RosterPageResponse>('roster/page', {
        ...normalized,
        cursor: pageParam,
      } satisfies RosterPageRequest),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
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
        queryClient.invalidateQueries({
          queryKey: auditKeys.all,
          refetchType: 'none',
        }),
        queryClient.invalidateQueries({
          queryKey: notificationKeys.all,
          refetchType: 'none',
        }),
      ]),
  })
}
