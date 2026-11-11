import { useQuery } from '@tanstack/react-query'
import type { MeResponse } from '@contracts/account'
import { useSession } from '@/features/auth/session'
import { callApi } from '@/lib/supabase/api'

export const meQueryKey = (userId: string | undefined) =>
  ['me', userId] as const

/** Профиль и роль текущего пользователя с сервера (единственный источник роли). */
export function useMe() {
  const session = useSession()
  const userId = session.session?.user.id
  return useQuery({
    queryKey: meQueryKey(userId),
    queryFn: () => callApi<MeResponse>('account/me'),
    enabled: session.status === 'signedIn',
    staleTime: 60_000,
  })
}
