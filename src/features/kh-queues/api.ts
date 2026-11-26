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
import {
  captureWindowScrollPosition,
  restoreWindowScrollPosition,
  type WindowScrollPosition,
} from './scroll-position'

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
    onMutate: async () => {
      const scrollPosition = captureWindowScrollPosition()
      await queryClient.cancelQueries({ queryKey: ['kh', 'settings'] })
      const previousSettings = queryClient.getQueryData<KhSettings>([
        'kh',
        'settings',
      ])
      if (previousSettings && route === 'kh/join') {
        queryClient.setQueryData<KhSettings>(['kh', 'settings'], {
          ...previousSettings,
          activeQueueCount: Math.min(
            previousSettings.activeQueueCount + 1,
            previousSettings.maxActiveQueues,
          ),
        })
      } else if (previousSettings && route === 'kh/leave') {
        queryClient.setQueryData<KhSettings>(['kh', 'settings'], {
          ...previousSettings,
          activeQueueCount: Math.max(previousSettings.activeQueueCount - 1, 0),
        })
      }
      return { scrollPosition, previousSettings }
    },
    onError: (_error, _input, context) => {
      if (context?.previousSettings) {
        queryClient.setQueryData(['kh', 'settings'], context.previousSettings)
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['kh', 'queues'] }),
        queryClient.invalidateQueries({ queryKey: ['kh', 'settings'] }),
      ])
    },
    onSettled: (_data, _error, _input, context) =>
      restoreWindowScrollPosition(context?.scrollPosition),
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

type KhSettings = { maxActiveQueues: number; activeQueueCount: number }
type KhQueuesCache = { pages: KhQueuesResponse[]; pageParams: unknown[] }

type KhSettingsMutationContext = {
  scrollPosition: WindowScrollPosition
  previousSettings: KhSettings | undefined
  previousQueues: KhQueuesCache | undefined
}

function useKhSettingsMutation(route: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: Record<string, unknown>) => callApi(route, input),
    onMutate: async (input) => {
      const scrollPosition = captureWindowScrollPosition()
      await queryClient.cancelQueries({ queryKey: ['kh', 'settings'] })
      await queryClient.cancelQueries({ queryKey: ['kh', 'queues'] })
      const previousSettings = queryClient.getQueryData<KhSettings>([
        'kh',
        'settings',
      ])
      const previousQueues = queryClient.getQueryData<KhQueuesCache>([
        'kh',
        'queues',
      ])
      if (
        previousSettings &&
        route === 'kh/set-limit' &&
        typeof input.maxActiveQueues === 'number'
      ) {
        queryClient.setQueryData<KhSettings>(['kh', 'settings'], {
          ...previousSettings,
          maxActiveQueues: input.maxActiveQueues,
        })
      }
      if (
        previousQueues &&
        route === 'kh/set-repeat' &&
        typeof input.queueKey === 'string' &&
        typeof input.entryId === 'string' &&
        typeof input.autoRejoin === 'boolean' &&
        KH_QUEUE_IDS.includes(input.queueKey as KhQueueId)
      ) {
        const queueKey = input.queueKey as KhQueueId
        queryClient.setQueryData<KhQueuesCache>(['kh', 'queues'], (current) =>
          current
            ? {
                ...current,
                pages: current.pages.map((page) => ({
                  ...page,
                  queues: {
                    ...page.queues,
                    [queueKey]: {
                      ...page.queues[queueKey],
                      items: page.queues[queueKey].items.map((entry) =>
                        entry.id === input.entryId
                          ? {
                              ...entry,
                              autoRejoin: input.autoRejoin as boolean,
                            }
                          : entry,
                      ),
                    },
                  },
                })),
              }
            : current,
        )
      }
      return {
        scrollPosition,
        previousSettings,
        previousQueues,
      } satisfies KhSettingsMutationContext
    },
    onError: (_error, _input, context) => {
      if (context?.previousSettings) {
        queryClient.setQueryData(['kh', 'settings'], context.previousSettings)
      }
      if (context?.previousQueues) {
        queryClient.setQueryData(['kh', 'queues'], context.previousQueues)
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['kh', 'settings'] }),
        queryClient.invalidateQueries({ queryKey: ['kh', 'queues'] }),
      ])
    },
    onSettled: (_data, _error, _input, context) =>
      restoreWindowScrollPosition(context?.scrollPosition),
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
