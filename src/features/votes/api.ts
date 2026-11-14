import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import type {
  CastBallotRequest,
  CloseVoteRequest,
  CreateVoteRequest,
  UpdateVoteRequest,
  VoteDetails,
  VoteListResponse,
} from '@contracts/votes'
import { applicationKeys } from '@/features/applications/query-keys'
import { discussionKeys } from '@/features/discussions/query-keys'
import { rosterKeys } from '@/features/roster/query-keys'
import { callApi } from '@/lib/supabase/api'
import { voteKeys } from './query-keys'

/** «Актуальные» — малый список (≤ 50 по ответу владельца): целиком. */
export function useActiveVotes(enabled = true) {
  return useQuery({
    queryKey: voteKeys.active,
    queryFn: () => callApi<VoteListResponse>('votes/list', { tab: 'active' }),
    enabled,
  })
}

/** «История» — большой список: страницы по курсору. */
export function useVoteHistory(enabled: boolean) {
  return useInfiniteQuery({
    queryKey: voteKeys.history,
    queryFn: ({ pageParam }) =>
      callApi<VoteListResponse>('votes/list', {
        tab: 'history',
        cursor: pageParam,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  })
}

export function useVote(id: string) {
  return useQuery({
    queryKey: voteKeys.detail(id),
    queryFn: () => callApi<VoteDetails>('votes/get', { id }),
  })
}

/**
 * Карточка из ответа операции кладётся в кеш карточки и заменяет элемент
 * актуального списка: после голоса список не перечитывается (квота Free).
 */
function storeVote(queryClient: QueryClient, vote: VoteDetails) {
  queryClient.setQueryData(voteKeys.detail(vote.id), vote)
  queryClient.setQueryData<VoteListResponse>(voteKeys.active, (list) =>
    list
      ? {
          ...list,
          items: list.items.map((item) =>
            item.id === vote.id ? { ...item, ...vote } : item,
          ),
        }
      : list,
  )
}

/** Голос или смена голоса (VOT-05, VOT-06). */
export function useCastBallot() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CastBallotRequest) =>
      callApi<VoteDetails>('votes/cast', input),
    onSuccess: (vote) => storeVote(queryClient, vote),
  })
}

export function useCreateVote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateVoteRequest) =>
      callApi<VoteDetails>('votes/create', input),
    onSuccess: async (vote) => {
      queryClient.setQueryData(voteKeys.detail(vote.id), vote)
      await queryClient.invalidateQueries({ queryKey: voteKeys.active })
    },
  })
}

export function useUpdateVote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateVoteRequest) =>
      callApi<VoteDetails>('votes/update', input),
    onSuccess: (vote) => storeVote(queryClient, vote),
  })
}

/** Сбрасывает связанную заявку: её статус меняют завершение и удаление. */
async function refreshApplication(
  queryClient: QueryClient,
  applicationId: string | undefined,
) {
  if (applicationId) {
    await queryClient.invalidateQueries({ queryKey: applicationKeys.all })
  }
}

/** Завершение обычного голосования или решение по заявке. */
export function useCloseVote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CloseVoteRequest) =>
      callApi<VoteDetails>('votes/close', input),
    onSuccess: async (vote) => {
      queryClient.setQueryData(voteKeys.detail(vote.id), vote)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: voteKeys.lists }),
        refreshApplication(queryClient, vote.applicationId),
        queryClient.invalidateQueries({ queryKey: rosterKeys.all }),
        // Ветка завершённого голосования — только для чтения (DSC-13).
        queryClient.invalidateQueries({ queryKey: discussionKeys.all }),
      ])
    },
  })
}

/** Удаление активного (VOT-11); заявочное возвращает заявку в очередь. */
export function useDeleteVote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vote: { id: string; applicationId?: string | undefined }) =>
      callApi<{ deleted: true }>('votes/delete', { id: vote.id }),
    onSuccess: async (_result, vote) => {
      queryClient.removeQueries({ queryKey: voteKeys.detail(vote.id) })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: voteKeys.lists }),
        refreshApplication(queryClient, vote.applicationId),
      ])
    },
  })
}
