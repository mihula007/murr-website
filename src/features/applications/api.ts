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
import { voteKeys } from '@/features/votes/query-keys'
import { callApi } from '@/lib/supabase/api'
import { applicationKeys } from './query-keys'

export { applicationKeys }

/** «Новые» — малый список (≤ 50 по ответу владельца): целиком. */
export function useNewApplications(enabled: boolean) {
  return useQuery({
    queryKey: applicationKeys.newQueue,
    queryFn: () =>
      callApi<ApplicationListResponse>('applications/list', { tab: 'new' }),
    enabled,
  })
}

/** «Окончательные решения» — малый список, только администратору (APP-08). */
export function useFinalApplications(enabled: boolean) {
  return useQuery({
    queryKey: applicationKeys.final,
    queryFn: () =>
      callApi<ApplicationListResponse>('applications/list', { tab: 'final' }),
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

export type DecisionKind = 'direct' | 'final'

const DECIDE_ROUTE = {
  direct: 'applications/decide',
  final: 'applications/final-decide',
} as const

/**
 * Прямое решение по новой заявке (APP-04) или окончательное решение
 * администратора после голосования (APP-08). После успеха карточка берётся
 * из ответа, очереди, состав и численность перечитываются.
 */
export function useDecideApplication(kind: DecisionKind = 'direct') {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: DecideApplicationRequest) =>
      callApi<ApplicationDetails>(DECIDE_ROUTE[kind], input),
    onSuccess: async (details) => {
      queryClient.setQueryData(applicationKeys.detail(details.id), details)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: applicationKeys.lists }),
        queryClient.invalidateQueries({ queryKey: rosterKeys.all }),
      ])
    },
  })
}

/** Передача новой заявки на голосование (APP-05). */
export function useSubmitToVote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      callApi<ApplicationDetails>('applications/submit-to-vote', { id }),
    onSuccess: async (details) => {
      queryClient.setQueryData(applicationKeys.detail(details.id), details)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: applicationKeys.lists }),
        queryClient.invalidateQueries({ queryKey: voteKeys.lists }),
      ])
    },
  })
}
