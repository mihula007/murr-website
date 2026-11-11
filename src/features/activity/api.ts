import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type {
  ActivityEventResponse,
  ActivityEventsResponse,
  ActivityHistoryResponse,
  ActivityMemberResponse,
  ActivitySummaryResponse,
  MonthTopResponse,
  RatingResponse,
} from '@contracts/activity'
import { callApi } from '@/lib/supabase/api'
import { activityKeys } from './query-keys'

/** Общие фильтры учёта (ACT-09): период по дате начала МСК и класс. */
export type ActivityFilters = {
  from: string | null
  to: string | null
  classId: number | null
}

/** Сводка за период — целиком (Q-48); поиск — на клиенте. */
export function useActivitySummary(filters: ActivityFilters) {
  return useQuery({
    queryKey: activityKeys.summary(filters),
    queryFn: () =>
      callApi<ActivitySummaryResponse>('activity/summary', filters),
  })
}

/** История — большой список: курсор, фильтры и поиск на сервере. */
export function useActivityHistory(
  filters: ActivityFilters & { search: string | null },
  enabled: boolean,
) {
  return useInfiniteQuery({
    queryKey: activityKeys.history(filters),
    queryFn: ({ pageParam }) =>
      callApi<ActivityHistoryResponse>('activity/history', {
        ...filters,
        cursor: pageParam,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  })
}

/** Закрытые события периода для выбора «По мероприятию». */
export function useActivityEvents(
  filters: { from: string | null; to: string | null; search: string | null },
  enabled: boolean,
) {
  return useInfiniteQuery({
    queryKey: activityKeys.events(filters),
    queryFn: ({ pageParam }) =>
      callApi<ActivityEventsResponse>('activity/events', {
        ...filters,
        cursor: pageParam,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  })
}

export function useActivityEvent(
  eventId: string | null,
  classId: number | null,
) {
  return useQuery({
    queryKey: activityKeys.event(eventId ?? '', classId),
    queryFn: () =>
      callApi<ActivityEventResponse>('activity/event', { eventId, classId }),
    enabled: eventId !== null,
  })
}

export function useActivityMember(
  userId: string | null,
  filters: ActivityFilters,
) {
  return useInfiniteQuery({
    queryKey: activityKeys.member(userId ?? '', filters),
    queryFn: ({ pageParam }) =>
      callApi<ActivityMemberResponse>('activity/member', {
        userId,
        ...filters,
        cursor: pageParam,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: userId !== null,
  })
}

/** Рейтинг посещения — весь текущий состав (Q-48). */
export function useAttendanceRating() {
  return useQuery({
    queryKey: activityKeys.rating,
    queryFn: () => callApi<RatingResponse>('activity/rating'),
  })
}

/** Топ-5 месяца — источник данных для главной (этап 10). */
export function useMonthTop(enabled = true) {
  return useQuery({
    queryKey: activityKeys.monthTop,
    queryFn: () => callApi<MonthTopResponse>('activity/month-top'),
    enabled,
  })
}
