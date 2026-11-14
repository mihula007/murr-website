import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  BroadcastDraftsResponse,
  BroadcastSource,
  BroadcastTemplatesResponse,
  PrefillResponse,
  SaveBroadcastTemplateRequest,
  SaveDraftRequest,
  SendAnnouncementRequest,
  SendAnnouncementResponse,
  TelegramRecipientsResponse,
} from '@contracts/broadcasts'
import { callApi } from '@/lib/supabase/api'

/** Ключи кеша рассылок. */
export const broadcastKeys = {
  all: ['broadcasts'] as const,
  drafts: ['broadcasts', 'drafts'] as const,
  templates: ['broadcasts', 'templates'] as const,
  recipients: ['broadcasts', 'recipients'] as const,
  prefill: (source: BroadcastSource, id: string) =>
    ['broadcasts', 'prefill', source, id] as const,
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
 * Число получателей для подтверждения (TGM-11): разовая проверка перед
 * отправкой, всегда свежая.
 */
export function useFetchRecipients() {
  const queryClient = useQueryClient()
  return () =>
    queryClient.fetchQuery({
      queryKey: broadcastKeys.recipients,
      queryFn: () =>
        callApi<TelegramRecipientsResponse>('broadcasts/recipients'),
      staleTime: 0,
    })
}

/** Отправка анонса в Telegram (TGM-11–TGM-16): данные сайта не меняются. */
export function useSendAnnouncement() {
  return useMutation({
    mutationFn: (input: SendAnnouncementRequest) =>
      callApi<SendAnnouncementResponse>('broadcasts/send', input),
  })
}
