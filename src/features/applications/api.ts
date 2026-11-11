import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import type {
  ApplicationDetails,
  ApplicationListResponse,
  DecideApplicationRequest,
} from '@contracts/applications'
import { rosterKeys } from '@/features/roster/query-keys'
import { callApi } from '@/lib/supabase/api'

export const applicationKeys = {
  all: ['applications'] as const,
  lists: ['applications', 'list'] as const,
  newQueue: ['applications', 'list', 'new'] as const,
  decided: ['applications', 'list', 'decided'] as const,
  detail: (id: string) => ['applications', 'detail', id] as const,
}

/** «Новые» — малый список (≤ 50 по ответу владельца): целиком. */
export function useNewApplications(enabled: boolean) {
  return useQuery({
    queryKey: applicationKeys.newQueue,
    queryFn: () =>
      callApi<ApplicationListResponse>('applications/list', { tab: 'new' }),
    enabled,
  })
}

/** «Решённые» — большой список: страницы по курсору. */
export function useDecidedApplications(enabled: boolean) {
  return useInfiniteQuery({
    queryKey: applicationKeys.decided,
    queryFn: ({ pageParam }) =>
      callApi<ApplicationListResponse>('applications/list', {
        tab: 'decided',
        cursor: pageParam,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
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
