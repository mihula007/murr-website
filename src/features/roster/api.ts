import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  RestoreReaderRequest,
  RoleChangeResult,
} from '@contracts/accounts'
import type {
  RosterCountResponse,
  RosterListResponse,
  RosterReadersResponse,
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

export function useRoster() {
  return useQuery({
    queryKey: rosterKeys.list,
    queryFn: () => callApi<RosterListResponse>('roster/list'),
  })
}

export function useReaders() {
  return useQuery({
    queryKey: rosterKeys.readers,
    queryFn: () => callApi<RosterReadersResponse>('roster/readers'),
    select: (data) => data.readers,
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
