import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import type {
  CreateEventRequest,
  EnsureWeeklyResponse,
  EventDetails,
  EventListResponse,
  EventSummary,
  EventTemplatesResponse,
  RespondEventRequest,
  SaveTemplateRequest,
  TemplateNextResponse,
  UpdateEventRequest,
} from '@contracts/events'
import { callApi } from '@/lib/supabase/api'
import { eventKeys } from './query-keys'

/** «Актуальные» — малый список (≤ 50 по ответу владельца): целиком. */
export function useActiveEvents(enabled = true) {
  return useQuery({
    queryKey: eventKeys.active,
    queryFn: () => callApi<EventListResponse>('events/list', { tab: 'active' }),
    enabled,
  })
}

/** «Прошедшие» — большой список: страницы по курсору. */
export function usePastEvents(enabled: boolean) {
  return useInfiniteQuery({
    queryKey: eventKeys.past,
    queryFn: ({ pageParam }) =>
      callApi<EventListResponse>('events/list', {
        tab: 'past',
        cursor: pageParam,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  })
}

export function useEvent(id: string) {
  return useQuery({
    queryKey: eventKeys.detail(id),
    queryFn: () => callApi<EventDetails>('events/get', { id }),
  })
}

/**
 * Карточка из ответа операции заменяет элемент актуального списка и поля
 * карточки события: после ответа список не перечитывается (квота Free).
 * Участников обновляет перечитывание карточки события.
 */
function storeSummary(queryClient: QueryClient, event: EventSummary) {
  queryClient.setQueryData<EventListResponse>(eventKeys.active, (list) =>
    list
      ? {
          ...list,
          items: list.items.map((item) =>
            item.id === event.id ? event : item,
          ),
        }
      : list,
  )
  queryClient.setQueryData<EventDetails>(eventKeys.detail(event.id), (card) =>
    card ? { ...card, ...event } : card,
  )
}

/** Ответ или смена ответа (EVT-04, EVT-05). */
export function useRespondToEvent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: RespondEventRequest) =>
      callApi<EventSummary>('events/respond', input),
    onSuccess: async (event) => {
      storeSummary(queryClient, event)
      await queryClient.invalidateQueries({
        queryKey: eventKeys.detail(event.id),
      })
    },
  })
}

export function useCreateEvent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateEventRequest) =>
      callApi<EventDetails>('events/create', input),
    onSuccess: async (event) => {
      queryClient.setQueryData(eventKeys.detail(event.id), event)
      await queryClient.invalidateQueries({ queryKey: eventKeys.active })
    },
  })
}

export function useUpdateEvent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateEventRequest) =>
      callApi<EventDetails>('events/update', input),
    onSuccess: async (event) => {
      queryClient.setQueryData(eventKeys.detail(event.id), event)
      // Время могло измениться — порядок списка тоже.
      await queryClient.invalidateQueries({ queryKey: eventKeys.active })
    },
  })
}

/** Удаление незакрытого события вместе с ответами (EVT-10). */
export function useDeleteEvent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      callApi<{ deleted: true }>('events/delete', { id }),
    onSuccess: async (_result, id) => {
      queryClient.removeQueries({ queryKey: eventKeys.detail(id) })
      await queryClient.invalidateQueries({ queryKey: eventKeys.lists })
    },
  })
}

/** Запасная кнопка выпуска постоянных событий недели (Q-42). */
export function useEnsureWeeklyEvents() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => callApi<EnsureWeeklyResponse>('events/ensure-weekly'),
    onSuccess: async (result) => {
      if (result.created.length > 0) {
        await queryClient.invalidateQueries({ queryKey: eventKeys.active })
      }
    },
  })
}

export function useEventTemplates() {
  return useQuery({
    queryKey: eventKeys.templates,
    queryFn: () => callApi<EventTemplatesResponse>('events/templates'),
  })
}

export function useSaveTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: SaveTemplateRequest) =>
      callApi<EventTemplatesResponse>('events/template-save', input),
    onSuccess: (templates) =>
      queryClient.setQueryData(eventKeys.templates, templates),
  })
}

export function useDeleteTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      callApi<EventTemplatesResponse>('events/template-delete', { id }),
    onSuccess: (templates) =>
      queryClient.setQueryData(eventKeys.templates, templates),
  })
}

/**
 * Ближайшая дата шаблона считается сервером (EVT-12): разовое чтение без
 * хранения — время «сейчас» меняется.
 */
export function fetchTemplateNextDate(queryClient: QueryClient, id: string) {
  return queryClient.fetchQuery({
    queryKey: [...eventKeys.templates, 'next', id],
    queryFn: () =>
      callApi<TemplateNextResponse>('events/template-next', { id }),
    staleTime: 0,
    gcTime: 0,
  })
}
