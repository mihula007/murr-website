import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase/client'

export type SessionState =
  | { status: 'unavailable'; session: null }
  | { status: 'loading'; session: null }
  | { status: 'signedOut'; session: null }
  | { status: 'signedIn'; session: Session }

const SessionContext = createContext<SessionState>({
  status: 'unavailable',
  session: null,
})

function toState(session: Session | null): SessionState {
  return session
    ? { status: 'signedIn', session }
    : { status: 'signedOut', session: null }
}

/**
 * Сессия Supabase Auth. При выходе и смене пользователя кеш запросов очищается,
 * чтобы данные прежнего аккаунта не показывались следующему.
 */
export function SessionProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient()
  const [state, setState] = useState<SessionState>(() =>
    getSupabaseClient()
      ? { status: 'loading', session: null }
      : { status: 'unavailable', session: null },
  )
  const userId = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    const supabase = getSupabaseClient()
    if (!supabase) return
    const apply = (session: Session | null) => {
      const nextId = session?.user.id ?? null
      if (userId.current !== undefined && userId.current !== nextId) {
        queryClient.clear()
      }
      userId.current = nextId
      setState(toState(session))
    }
    void supabase.auth.getSession().then(({ data }) => apply(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, session) =>
      apply(session),
    )
    return () => data.subscription.unsubscribe()
  }, [queryClient])

  return <SessionContext value={state}>{children}</SessionContext>
}

export function useSession() {
  return useContext(SessionContext)
}
