import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { MaxLinkStart, MaxStatus } from '@contracts/max'
import { callApi } from '@/lib/supabase/api'
import { maxKeys } from './query-keys'

/**
 * Состояние привязки (MAX-01): перечитывается при возврате на вкладку —
 * пользователь привязывает аккаунт в MAX и возвращается на сайт.
 */
export function useMaxStatus() {
  return useQuery({
    queryKey: maxKeys.status,
    queryFn: () => callApi<MaxStatus>('max/status'),
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  })
}

/** Одноразовая ссылка на бота (MAX-01). */
export function useStartMaxLink() {
  return useMutation({
    mutationFn: () => callApi<MaxLinkStart>('max/link-start'),
  })
}

/** Отвязка (MAX-01). */
export function useUnlinkMax() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => callApi<MaxStatus>('max/unlink'),
    onSuccess: (data) => queryClient.setQueryData(maxKeys.status, data),
  })
}
