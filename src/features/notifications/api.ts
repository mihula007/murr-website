import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  NOTIFICATION_LIMITS,
  type NewsSection,
  type NotificationListResponse,
  type NotificationReadResponse,
  type NotificationSummaryResponse,
} from '@contracts/notifications'
import { callApi } from '@/lib/supabase/api'
import { notificationKeys } from './query-keys'

/**
 * Опрос шапки (Q-66): непрочитанные и новизна разделов раз в 60 с, только при
 * видимой вкладке; при возврате на вкладку — сразу.
 */
export function useNotificationSummary(enabled: boolean) {
  return useQuery({
    queryKey: notificationKeys.summary,
    queryFn: () =>
      callApi<NotificationSummaryResponse>('notifications/summary'),
    enabled,
    refetchInterval: NOTIFICATION_LIMITS.pollMs,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: NOTIFICATION_LIMITS.pollMs,
  })
}

/** Последние уведомления — только пока открыта панель (Q-64). */
export function useNotificationList(enabled: boolean) {
  return useQuery({
    queryKey: notificationKeys.list,
    queryFn: () => callApi<NotificationListResponse>('notifications/list'),
    enabled,
    staleTime: 0,
  })
}

function setUnread(
  queryClient: ReturnType<typeof useQueryClient>,
  unreadCount: number,
) {
  queryClient.setQueryData<NotificationSummaryResponse>(
    notificationKeys.summary,
    (old) => (old ? { ...old, unreadCount } : old),
  )
}

/** Нажатие записи отмечает только её (NTF-05). */
export function useReadNotification() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      callApi<NotificationReadResponse>('notifications/read', { id }),
    onSuccess: (result, id) => {
      setUnread(queryClient, result.unreadCount)
      queryClient.setQueryData<NotificationListResponse>(
        notificationKeys.list,
        (old) =>
          old && {
            unreadCount: result.unreadCount,
            items: old.items.map((item) =>
              item.id === id && !item.readAt
                ? { ...item, readAt: new Date().toISOString() }
                : item,
            ),
          },
      )
    },
  })
}

/** «Прочитать все» — вся своя история сохраняется (NTF-05). */
export function useReadAllNotifications() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      callApi<NotificationReadResponse>('notifications/read-all'),
    onSuccess: (result) => {
      setUnread(queryClient, result.unreadCount)
      void queryClient.invalidateQueries({ queryKey: notificationKeys.list })
    },
  })
}

/** Открытие раздела снимает его новизну у себя (NTF-11). */
export function useMarkSectionSeen() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (section: NewsSection) =>
      callApi<{ ok: true }>('notifications/section-seen', { section }),
    onSuccess: (_result, section) => {
      queryClient.setQueryData<NotificationSummaryResponse>(
        notificationKeys.summary,
        (old) => old && { ...old, sections: { ...old.sections, [section]: 0 } },
      )
    },
  })
}
