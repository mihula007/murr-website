import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type { CharacterStatNumberField } from '@contracts/character-stats'
import type {
  DynamicsAttendanceResponse,
  DynamicsProfileResponse,
  DynamicsStatsResponse,
} from '@contracts/roster-dynamics'
import { callApi } from '@/lib/supabase/api'
import { rosterKeys } from './query-keys'

export type DynamicsPeriod = '30' | '90' | '365' | 'all'

export function useDynamicsProfile(userId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['roster', 'dynamics-profile', userId],
    queryFn: () =>
      callApi<DynamicsProfileResponse>('roster/dynamics/profile', { userId }),
    enabled,
  })
}

export function useDynamicsStats(
  userId: string,
  period: DynamicsPeriod,
  fields: CharacterStatNumberField[],
  enabled: boolean,
) {
  const sorted = [...fields].sort()
  return useInfiniteQuery({
    queryKey: rosterKeys.dynamics(userId, period, sorted),
    queryFn: ({ pageParam }) =>
      callApi<DynamicsStatsResponse>('roster/dynamics/stats', {
        userId,
        period,
        fields: sorted,
        cursor: pageParam,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  })
}

export function useDynamicsAttendance(
  userId: string,
  period: DynamicsPeriod,
  enabled: boolean,
) {
  return useInfiniteQuery({
    queryKey: ['roster', 'dynamics-attendance', userId, period],
    queryFn: ({ pageParam }) =>
      callApi<DynamicsAttendanceResponse>('roster/dynamics/attendance', {
        userId,
        period,
        cursor: pageParam,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  })
}
