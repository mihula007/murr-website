import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  OfficerPermissionsResponse,
  OfficerPermissionsRosterResponse,
  OfficerPermissionsSaveRequest,
} from '@contracts/officer-permissions'
import { auditKeys } from '@/features/admin/query-keys'
import { meQueryKey } from '@/features/account/use-me'
import { useSession } from '@/features/auth/session'
import { callApi } from '@/lib/supabase/api'

export const officerPermissionsKeys = {
  all: ['officer-permissions'] as const,
  roster: ['officer-permissions', 'roster'] as const,
}

export function useOfficerPermissionsRoster() {
  return useQuery({
    queryKey: officerPermissionsKeys.roster,
    queryFn: () =>
      callApi<OfficerPermissionsRosterResponse>('officer-permissions/list'),
  })
}

export function useSaveOfficerPermissions() {
  const queryClient = useQueryClient()
  const session = useSession()
  const userId = session.session?.user.id
  return useMutation({
    mutationFn: (input: OfficerPermissionsSaveRequest) =>
      callApi<OfficerPermissionsResponse>('officer-permissions/save', input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: officerPermissionsKeys.all,
        }),
        queryClient.invalidateQueries({
          queryKey: auditKeys.all,
          refetchType: 'none',
        }),
        queryClient.invalidateQueries({
          queryKey: meQueryKey(userId),
          refetchType: 'none',
        }),
      ])
    },
  })
}
