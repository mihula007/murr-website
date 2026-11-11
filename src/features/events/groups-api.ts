import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import type { EventDetails } from '@contracts/events'
import type {
  ApplyGroupTemplateRequest,
  CreateGroupRequest,
  EventGroupsResponse,
  GroupTemplatesResponse,
  MoveMemberRequest,
  RenameGroupRequest,
  SaveGroupTemplateRequest,
  SetLeaderRequest,
} from '@contracts/groups'
import { callApi } from '@/lib/supabase/api'
import { activityKeys } from '@/features/activity/query-keys'
import { eventKeys } from './query-keys'

/**
 * Группы из ответа операции заменяют группы в карточке события: участники
 * не перечитываются (квота Free, подписанные ссылки аватаров).
 */
function storeGroups(
  queryClient: QueryClient,
  eventId: string,
  result: EventGroupsResponse,
) {
  queryClient.setQueryData<EventDetails>(eventKeys.detail(eventId), (card) =>
    card ? { ...card, groups: result.groups } : card,
  )
}

/** Изменение групп события: ответ сервера — новые группы (GRP-03–09, GRP-15). */
function useGroupsMutation<T extends object>(route: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ input }: { eventId: string; input: T }) =>
      callApi<EventGroupsResponse>(route, input),
    onSuccess: (result, { eventId }) =>
      storeGroups(queryClient, eventId, result),
  })
}

export const useCreateGroup = () =>
  useGroupsMutation<CreateGroupRequest>('groups/create')
export const useRenameGroup = () =>
  useGroupsMutation<RenameGroupRequest>('groups/rename')
export const useDeleteGroup = () =>
  useGroupsMutation<{ groupId: string }>('groups/delete')
export const useMoveMember = () =>
  useGroupsMutation<MoveMemberRequest>('groups/move')
export const useSetGroupLeader = () =>
  useGroupsMutation<SetLeaderRequest>('groups/set-leader')
export const useApplyGroupTemplate = () =>
  useGroupsMutation<ApplyGroupTemplateRequest>('group-templates/apply')

/** Общая библиотека шаблонов групп (GRP-12). */
export function useGroupTemplates(enabled = true) {
  return useQuery({
    queryKey: eventKeys.groupTemplates,
    queryFn: () => callApi<GroupTemplatesResponse>('group-templates/list'),
    enabled,
  })
}

export function useSaveGroupTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: SaveGroupTemplateRequest) =>
      callApi<GroupTemplatesResponse>('group-templates/save', input),
    onSuccess: (templates) =>
      queryClient.setQueryData(eventKeys.groupTemplates, templates),
  })
}

export function useDeleteGroupTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      callApi<GroupTemplatesResponse>('group-templates/delete', { id }),
    onSuccess: (templates) =>
      queryClient.setQueryData(eventKeys.groupTemplates, templates),
  })
}

/**
 * Закрытие события (EVT-08): карточка — из ответа; списки событий и учёт
 * активности перечитываются.
 */
export function useCloseEvent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => callApi<EventDetails>('events/close', { id }),
    onSuccess: async (event) => {
      queryClient.setQueryData(eventKeys.detail(event.id), event)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: eventKeys.lists }),
        queryClient.invalidateQueries({ queryKey: activityKeys.all }),
      ])
    },
  })
}
