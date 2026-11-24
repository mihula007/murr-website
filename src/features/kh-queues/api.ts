import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import type { KhQueueId, KhQueuePage, KhQueuesResponse } from '@contracts/kh'
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
    onSuccess: () => queryClient.resetQueries({ queryKey: ['kh', 'queues'] }),
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
