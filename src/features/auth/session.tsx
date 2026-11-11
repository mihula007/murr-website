import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  isAuthConfigured,
  subscribeToSession,
  type AuthSession,
} from './auth-api'

export type SessionState =
  | { status: 'unavailable'; session: null }
  | { status: 'loading'; session: null }
  | { status: 'signedOut'; session: null }
  | { status: 'signedIn'; session: AuthSession }

const SessionContext = createContext<SessionState>({
  status: 'unavailable',
  session: null,
})

function toState(session: AuthSession | null): SessionState {
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
    isAuthConfigured()
      ? { status: 'loading', session: null }
      : { status: 'unavailable', session: null },
  )
  const userId = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    const unsubscribe = subscribeToSession((session) => {
      const nextId = session?.user.id ?? null
      if (userId.current !== undefined && userId.current !== nextId) {
        queryClient.clear()
      }
      userId.current = nextId
      setState(toState(session))
    })
    return unsubscribe ?? undefined
  }, [queryClient])

  return <SessionContext value={state}>{children}</SessionContext>
}

export function useSession() {
  return useContext(SessionContext)
}
