import { act, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { AccessProvider, useAccess } from '@/app/access'
import { RouteGate } from '@/components/route-gate'
import { SessionProvider } from '@/features/auth/session'

const sessionMock = vi.hoisted(() => ({
  value: { status: 'signedOut' } as unknown,
}))
const meMock = vi.hoisted(() => ({ value: {} as unknown }))

vi.mock('@/features/account/use-me', () => ({ useMe: () => meMock.value }))

function Probe() {
  const { role, status, nickname } = useAccess()
  return (
    <p>
      {role}:{status}
      {nickname ? `:${nickname}` : ''}
    </p>
  )
}

describe('AccessProvider from the session', () => {
  async function renderAccess(session: unknown, me: unknown, ui = <Probe />) {
    sessionMock.value = session
    meMock.value = me
    const { useSession } = await import('@/features/auth/session')
    vi.spyOn(
      await import('@/features/auth/session'),
      'useSession',
    ).mockImplementation(
      () => sessionMock.value as ReturnType<typeof useSession>,
    )
    return render(<AccessProvider>{ui}</AccessProvider>)
  }

  const signedIn = { status: 'signedIn', session: { user: { id: 'u1' } } }

  it('takes the role from the server profile', async () => {
    await renderAccess(signedIn, {
      isPending: false,
      isError: false,
      data: { state: 'ready', profile: { role: 'officer' } },
    })
    expect(screen.getByText('officer:ready')).toBeInTheDocument()
  })

  it('provides the current nickname from the profile', async () => {
    await renderAccess(signedIn, {
      isPending: false,
      isError: false,
      data: {
        state: 'ready',
        profile: { role: 'member', gameNickname: 'Мурка' },
      },
    })
    expect(screen.getByText('member:ready:Мурка')).toBeInTheDocument()
  })

  it('treats an incomplete registration as a guest', async () => {
    await renderAccess(signedIn, {
      isPending: false,
      isError: false,
      data: { state: 'incomplete', email: 'a@b.c' },
    })
    expect(screen.getByText('guest:incomplete')).toBeInTheDocument()
  })

  it('is a guest without a session', async () => {
    await renderAccess(
      { status: 'signedOut', session: null },
      { isPending: true },
    )
    expect(screen.getByText('guest:guest')).toBeInTheDocument()
  })

  it('shows loading in the route gate while the profile loads', async () => {
    await renderAccess(
      signedIn,
      { isPending: true },
      <RouteGate roles={['member']}>
        <p>Закрытое</p>
      </RouteGate>,
    )
    expect(screen.getByText('Проверяем доступ…')).toBeInTheDocument()
    expect(screen.queryByText('Закрытое')).not.toBeInTheDocument()
  })

  it('offers a retry when the profile fails to load', async () => {
    const refetch = vi.fn<() => void>()
    await renderAccess(
      signedIn,
      { isPending: false, isError: true, refetch },
      <RouteGate roles={['member']}>
        <p>Закрытое</p>
      </RouteGate>,
    )
    act(() => screen.getByRole('button', { name: 'Повторить' }).click())
    expect(refetch).toHaveBeenCalled()
  })
})

describe('SessionProvider', () => {
  it('clears the query cache when the signed-in user changes', async () => {
    let emit: (session: unknown) => void = () => {}
    const fakeClient = {
      auth: {
        getSession: () =>
          Promise.resolve({ data: { session: { user: { id: 'a' } } } }),
        onAuthStateChange: (
          callback: (event: string, session: unknown) => void,
        ) => {
          emit = (session) => callback('SIGNED_IN', session)
          return { data: { subscription: { unsubscribe: () => {} } } }
        },
      },
    }
    vi.spyOn(
      await import('@/lib/supabase/client'),
      'getSupabaseClient',
    ).mockReturnValue(fakeClient as never)
    const queryClient = new QueryClient()
    queryClient.setQueryData(['me', 'a'], { secret: true })
    render(
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <p>ok</p>
        </SessionProvider>
      </QueryClientProvider>,
    )
    await act(async () => {})
    expect(queryClient.getQueryData(['me', 'a'])).toEqual({ secret: true })
    act(() => emit(null))
    expect(queryClient.getQueryData(['me', 'a'])).toBeUndefined()
  })
})
