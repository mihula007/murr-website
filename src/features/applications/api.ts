import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import type {
  ApplicationDetails,
  ApplicationListResponse,
  ApplicationTab,
  DecideApplicationRequest,
} from '@contracts/applications'
import { rosterKeys } from '@/features/roster/query-keys'
import { callApi } from '@/lib/supabase/api'

export const applicationKeys = {
  all: ['applications'] as const,
  lists: ['applications', 'list'] as const,
  list: (tab: ApplicationTab, page: number) =>
    ['applications', 'list', tab, page] as const,
  detail: (id: string) => ['applications', 'detail', id] as const,
}

/** Очередь заявок: вкладка «Новые» целиком, «Решённые» — постранично. */
export function useApplicationList(tab: ApplicationTab, page: number) {
  return useQuery({
    queryKey: applicationKeys.list(tab, page),
    queryFn: () =>
      callApi<ApplicationListResponse>('applications/list', { tab, page }),
    placeholderData: keepPreviousData,
  })
}

export function useApplication(id: string) {
  return useQuery({
    queryKey: applicationKeys.detail(id),
    queryFn: () => callApi<ApplicationDetails>('applications/get', { id }),
  })
}

/**
 * Прямое решение по новой заявке. После успеха карточка берётся из ответа,
 * очередь, состав и численность перечитываются.
 */
export function useDecideApplication() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: DecideApplicationRequest) =>
      callApi<ApplicationDetails>('applications/decide', input),
    onSuccess: async (details) => {
      queryClient.setQueryData(applicationKeys.detail(details.id), details)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: applicationKeys.lists }),
        queryClient.invalidateQueries({ queryKey: rosterKeys.all }),
      ])
    },
  })
}
