import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import {
  DISCUSSION_LIMITS,
  type DiscussionChanges,
  type DiscussionMessage,
  type DiscussionPage,
  type DiscussionReactions,
  type DiscussionReaders,
  type Reaction,
  type ThreadRef,
} from '@contracts/discussions'
import { eventKeys } from '@/features/events/query-keys'
import { marketKeys } from '@/features/market/query-keys'
import { publicationKeys } from '@/features/publications/query-keys'
import { voteKeys } from '@/features/votes/query-keys'
import { callApi } from '@/lib/supabase/api'
import { discussionKeys } from './query-keys'
import { mergeMessages, type ThreadData } from './thread-cache'

/** Ветка: страницы от новых к старым по курсору (Q-62). */
export function useThread(ref: ThreadRef) {
  return useInfiniteQuery({
    queryKey: discussionKeys.thread(ref),
    queryFn: ({ pageParam }) =>
      callApi<DiscussionPage>('discussions/list', {
        ...ref,
        cursor: pageParam,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  })
}

/**
 * Опрос открытой ветки раз в 30 с (Q-58). Работает, только пока компонент
 * смонтирован (окно открыто) и вкладка видима: TanStack Query не опрашивает
 * скрытую вкладку и сразу опрашивает при возврате на неё. Изменения
 * сливаются в кеш ветки; переполнение — перечитать ветку целиком.
 */
export function useThreadPolling(ref: ThreadRef, since: string | null) {
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: discussionKeys.changes(ref),
    queryFn: async () => {
      const latest =
        queryClient.getQueryData<ThreadData>(discussionKeys.thread(ref))
          ?.pages[0]?.now ?? since
      const changes = await callApi<DiscussionChanges>('discussions/changes', {
        ...ref,
        since: latest,
      })
      if (changes.reset) {
        await queryClient.resetQueries({ queryKey: discussionKeys.thread(ref) })
      } else {
        queryClient.setQueryData<ThreadData>(
          discussionKeys.thread(ref),
          (data) =>
            mergeMessages(data, changes.items, {
              canWrite: changes.canWrite,
              othersReadUpTo: changes.othersReadUpTo,
              now: changes.now,
            }),
        )
      }
      return changes
    },
    enabled: since !== null,
    refetchInterval: DISCUSSION_LIMITS.pollMs,
    refetchIntervalInBackground: false,
    staleTime: DISCUSSION_LIMITS.pollMs,
  })
}

/** Карточки родителя: счётчик сообщений (DSC-01) перечитывается. */
const PARENT_KEYS = {
  event: { lists: eventKeys.lists, detail: eventKeys.detail },
  vote: { lists: voteKeys.lists, detail: voteKeys.detail },
  publication: {
    lists: publicationKeys.lists,
    detail: publicationKeys.detail,
  },
  market: { lists: marketKeys.lists, detail: marketKeys.detail },
} as const

function storeMessage(
  queryClient: QueryClient,
  ref: ThreadRef,
  message: DiscussionMessage,
) {
  queryClient.setQueryData<ThreadData>(discussionKeys.thread(ref), (data) =>
    mergeMessages(data, [message]),
  )
}

/** Новое сообщение или ответ (DSC-03–DSC-05). */
export function useSendMessage(ref: ThreadRef) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { body: string; replyToId: string | null }) =>
      callApi<DiscussionMessage>('discussions/send', { ...ref, ...input }),
    onSuccess: async (message) => {
      storeMessage(queryClient, ref, message)
      const keys = PARENT_KEYS[ref.parent]
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.detail(ref.parentId) }),
        // Ленты перечитаются при следующем открытии, а не сейчас (квота Free).
        queryClient.invalidateQueries({
          queryKey: keys.lists,
          refetchType: 'none',
        }),
      ])
    },
  })
}

/** Правка своего сообщения в течение 5 минут (DSC-08). */
export function useEditMessage(ref: ThreadRef) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { messageId: string; body: string }) =>
      callApi<DiscussionMessage>('discussions/edit', input),
    onSuccess: (message) => storeMessage(queryClient, ref, message),
  })
}

/** Поставить или снять свою реакцию (DSC-11). */
export function useReact(ref: ThreadRef) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { messageId: string; emoji: Reaction }) =>
      callApi<DiscussionMessage>('discussions/react', input),
    onSuccess: async (message) => {
      storeMessage(queryClient, ref, message)
      await queryClient.invalidateQueries({
        queryKey: discussionKeys.reactions(message.id),
        refetchType: 'none',
      })
    },
  })
}

/** Отметка «прочитано до» (DSC-12). */
export function useMarkRead(ref: ThreadRef) {
  return useMutation({
    mutationFn: (upTo: string) =>
      callApi<{ readUpTo: string | null }>('discussions/mark-read', {
        ...ref,
        upTo,
      }),
  })
}

/** Прочитавшие сообщение (Q-59): участники клана целиком (Q-62). */
export function useReaders(messageId: string, enabled: boolean) {
  return useQuery({
    queryKey: discussionKeys.readers(messageId),
    queryFn: () =>
      callApi<DiscussionReaders>('discussions/readers', { messageId }),
    enabled,
  })
}

/** Поставившие реакции (DSC-11): участники клана целиком (Q-62). */
export function useReactionPeople(messageId: string, enabled: boolean) {
  return useQuery({
    queryKey: discussionKeys.reactions(messageId),
    queryFn: () =>
      callApi<DiscussionReactions>('discussions/reactions', { messageId }),
    enabled,
  })
}
