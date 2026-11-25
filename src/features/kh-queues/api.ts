import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import type { KhQueueId, KhQueuePage, KhQueuesResponse } from '@contracts/kh'
import type { KhRewardHistoryResponse } from '@contracts/kh'
import { KH_QUEUE_IDS } from '@contracts/kh'
import { callApi } from '@/lib/supabase/api'

type Cursors = Partial<Record<KhQueueId, string>>
type PageParam = Cursors | null

export function useKhQueues() {
  return useInfiniteQuery({
    queryKey: ['kh', 'queues'],
    queryFn: ({ pageParam }) =>
      callApi<KhQueuesResponse>('kh/queues', {
        ...(pageParam ? { cursors: pageParam } : {}),
      }),
    initialPageParam: null as PageParam,
    getNextPageParam: (last): PageParam | undefined => {
      const cursors: Cursors = {}
      for (const queueKey of KH_QUEUE_IDS) {
        const cursor = last.queues[queueKey].nextCursor
        if (cursor) {
          cursors[queueKey] = cursor
        }
      }
      return Object.keys(cursors).length ? cursors : undefined
    },
    select: (data) =>
      Object.fromEntries(
        KH_QUEUE_IDS.map((queueKey) => {
          const pages: KhQueuePage[] = data.pages.map(
            (page) => page.queues[queueKey],
          )
          return [
            queueKey,
            {
              items: pages.flatMap((page) => page.items),
              hasMore: pages.at(-1)?.nextCursor !== null,
            },
          ]
        }),
      ),
  })
}

function useKhAction(route: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { queueKey: KhQueueId; entryId?: string }) =>
      callApi(route, {
        queueKey: input.queueKey,
        ...(input.entryId ? { entryId: input.entryId } : {}),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['kh', 'queues'] }),
  })
}

export function useJoinKhQueue() {
  return useKhAction('kh/join')
}

export function useLeaveKhQueue() {
  return useKhAction('kh/leave')
}

export function useIssueKhReward() {
  return useKhAction('kh/issue')
}

export function useKhQueueSettings() {
  return useQuery({
    queryKey: ['kh', 'settings'],
    queryFn: () =>
      callApi<{ maxActiveQueues: number; activeQueueCount: number }>(
        'kh/settings',
      ),
  })
}

function useKhSettingsMutation(route: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: Record<string, unknown>) => callApi(route, input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['kh', 'settings'] }),
        queryClient.invalidateQueries({ queryKey: ['kh', 'queues'] }),
      ])
    },
  })
}

export function useSetKhQueueLimit() {
  return useKhSettingsMutation('kh/set-limit')
}

export function useSetKhQueueRepeat() {
  return useKhSettingsMutation('kh/set-repeat')
}

export function useRemoveKhQueueEntry() {
  return useKhSettingsMutation('kh/remove')
}

export function useKhRewardHistory(dateFrom: string, dateTo: string) {
  return useInfiniteQuery({
    queryKey: ['kh', 'history', dateFrom, dateTo],
    enabled: dateFrom <= dateTo,
    queryFn: ({ pageParam }) =>
      callApi<KhRewardHistoryResponse>('kh/history', {
        dateFrom,
        dateTo,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    select: (data) => ({
      items: data.pages.flatMap((page) => page.items),
      hasNextPage: data.pages.at(-1)?.nextCursor !== null,
    }),
  })
}
