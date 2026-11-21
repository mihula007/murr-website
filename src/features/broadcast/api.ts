import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import type {
  BroadcastDraftsResponse,
  BroadcastRecipientsResponse,
  BroadcastSource,
  BroadcastSubscriptionsResponse,
  BroadcastTemplatesResponse,
  PrefillResponse,
  SaveBroadcastTemplateRequest,
  SaveDraftRequest,
  SendAnnouncementRequest,
  SendAnnouncementResponse,
  SendableChannel,
} from '@contracts/broadcasts'
import { callApi } from '@/lib/supabase/api'

/** Ключи кеша рассылок. */
export const broadcastKeys = {
  all: ['broadcasts'] as const,
  drafts: ['broadcasts', 'drafts'] as const,
  templates: ['broadcasts', 'templates'] as const,
  subscriptions: (search: string, unlinkedOnly: boolean) =>
    ['broadcasts', 'subscriptions', search, unlinkedOnly] as const,
  recipients: ['broadcasts', 'recipients'] as const,
  prefill: (source: BroadcastSource, id: string) =>
    ['broadcasts', 'prefill', source, id] as const,
}

/** Состав и статусы привязок для вкладки рассылок (BRC-15). */
export function useBroadcastSubscriptions(
  search: string,
  unlinkedOnly: boolean,
  enabled = true,
) {
  return useInfiniteQuery({
    queryKey: broadcastKeys.subscriptions(search, unlinkedOnly),
    queryFn: ({ pageParam }) =>
      callApi<BroadcastSubscriptionsResponse>('broadcasts/subscriptions', {
        cursor: pageParam,
        ...(search ? { search } : {}),
        ...(unlinkedOnly ? { unlinkedOnly: true } : {}),
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
    select: (data) => data.pages.flatMap((page) => page.items),
  })
}

/** Cursor pages of people who can receive the current announcement (BRC-16). */
export function useBroadcastRecipientOptions(
  search: string,
  channels: SendableChannel[],
  classId: number | null,
  groupId: string | null,
  eventId: string | null,
) {
  return useInfiniteQuery({
    queryKey: [
      ...broadcastKeys.recipients,
      'options',
      channels,
      classId,
      groupId,
      eventId,
      search,
    ],
    queryFn: ({ pageParam }) =>
      callApi<BroadcastRecipientsResponse>('broadcasts/recipients', {
        cursor: pageParam,
        channels,
        ...(classId !== null ? { classId } : {}),
        ...(groupId ? { groupId } : {}),
        ...(eventId ? { eventId } : {}),
        ...(search ? { search } : {}),
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: channels.length > 0,
    staleTime: 0,
  })
}

/** Тема и текст из события, голосования или группы (BRC-02–04). */
export function usePrefill(
  target: { source: BroadcastSource; id: string } | null,
) {
  return useQuery({
    queryKey: broadcastKeys.prefill(
      target?.source ?? 'event',
      target?.id ?? '',
    ),
    queryFn: () =>
      callApi<PrefillResponse>('broadcasts/prefill', target ?? undefined),
    enabled: target !== null,
    // Закрытый источник или пустая группа не исправятся повтором.
    retry: false,
    // Каждое открытие из контекста — свежий текст.
    staleTime: 0,
    gcTime: 0,
  })
}

/** Черновики — малый список, целиком (Q-69). */
export function useDrafts() {
  return useQuery({
    queryKey: broadcastKeys.drafts,
    queryFn: () => callApi<BroadcastDraftsResponse>('broadcasts/drafts'),
  })
}

export function useSaveDraft() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: SaveDraftRequest) =>
      callApi<BroadcastDraftsResponse>('broadcasts/save-draft', input),
    onSuccess: (data) => queryClient.setQueryData(broadcastKeys.drafts, data),
  })
}

export function useDeleteDraft() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      callApi<BroadcastDraftsResponse>('broadcasts/delete-draft', { id }),
    onSuccess: (data) => queryClient.setQueryData(broadcastKeys.drafts, data),
  })
}

/** Шаблоны — общие, не больше 20 (BRC-10, Q-70). */
export function useBroadcastTemplates() {
  return useQuery({
    queryKey: broadcastKeys.templates,
    queryFn: () => callApi<BroadcastTemplatesResponse>('broadcasts/templates'),
  })
}

export function useSaveBroadcastTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: SaveBroadcastTemplateRequest) =>
      callApi<BroadcastTemplatesResponse>('broadcasts/save-template', input),
    onSuccess: (data) =>
      queryClient.setQueryData(broadcastKeys.templates, data),
  })
}

export function useDeleteBroadcastTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      callApi<BroadcastTemplatesResponse>('broadcasts/delete-template', { id }),
    onSuccess: (data) =>
      queryClient.setQueryData(broadcastKeys.templates, data),
  })
}

/**
 * Число получателей по каналам для подтверждения (TGM-11, MAX-05): разовая
 * проверка перед
 * отправкой, всегда свежая.
 */
export function useFetchRecipients() {
  const queryClient = useQueryClient()
  // Анонс группы — получатели только из неё (Q-104); анонс события — без
  // ответивших на него (Q-109).
  return (
    groupId: string | null = null,
    eventId: string | null = null,
    excludedUserIds: string[] = [],
  ) =>
    queryClient.fetchQuery({
      queryKey: [
        ...broadcastKeys.recipients,
        groupId,
        eventId,
        excludedUserIds,
      ],
      queryFn: () =>
        callApi<BroadcastRecipientsResponse>(
          'broadcasts/recipients',
          groupId || eventId || excludedUserIds.length > 0
            ? {
                ...(groupId ? { groupId } : {}),
                ...(eventId ? { eventId } : {}),
                ...(excludedUserIds.length > 0 ? { excludedUserIds } : {}),
              }
            : undefined,
        ),
      staleTime: 0,
    })
}

/** Отправка анонса в выбранные каналы (TGM-11–TGM-16, MAX-05): данные сайта не меняются. */
export function useSendAnnouncement() {
  return useMutation({
    mutationFn: (input: SendAnnouncementRequest) =>
      callApi<SendAnnouncementResponse>('broadcasts/send', input),
  })
}
