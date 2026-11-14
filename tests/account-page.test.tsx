import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderApp } from './support/render-app'

const me = vi.hoisted(() => ({ value: {} as unknown }))
const accountLoad = vi.hoisted(() => ({ failed: false }))
const accessState = vi.hoisted(() => ({ failed: false }))
const callApi = vi.hoisted(() =>
  vi.fn<(route: string, body?: unknown) => Promise<unknown>>(),
)
const signIn = vi.hoisted(() => vi.fn<(input: unknown) => Promise<unknown>>())
const updateUser = vi.hoisted(() =>
  vi.fn<(input: unknown) => Promise<unknown>>(),
)
const signOut = vi.hoisted(() => vi.fn<() => Promise<{ error: unknown }>>())

vi.mock('@/app/access', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/app/access')>()
  return {
    ...original,
    useAccess: () => {
      const access = original.useAccess()
      return accessState.failed
        ? { ...access, role: 'guest' as const, status: 'error' as const }
        : access
    },
  }
})

vi.mock('@/features/account/use-me', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useMe: () => ({
    data: me.value,
    isPending: false,
    isError: accountLoad.failed,
    refetch: vi.fn<() => void>(),
  }),
}))
vi.mock('@/lib/supabase/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  callApi,
}))
vi.mock('@/lib/supabase/client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requireSupabase: () => ({
    auth: {
      signInWithPassword: signIn,
      updateUser,
      signOut,
    },
  }),
}))

/** jsdom не раскрывает <details> по клику на summary. */
async function openDetails(summary: string) {
  const details = (await screen.findByText(summary)).closest('details')
  if (!details) {
    throw new Error('нет details')
  }
  details.open = true
  fireEvent(details, new Event('toggle'))
}

function profile(role: string, extra: Record<string, unknown> = {}) {
  return {
    state: 'ready',
    email: 'anna@example.com',
    application:
      role === 'applicant'
        ? {
            id: 'a1',
            status: 'pending_officer_review',
            submittedAt: '2026-11-08',
          }
        : null,
    profile: {
      id: 'u1',
      displayName: 'Анна',
      gameNickname: 'Рейна',
      city: 'Москва',
      birthDate: '1995-04-12',
      classId: 7,
      className: 'Маг',
      about: 'Играю давно',
      avatarUrl: 'https://example.test/avatar.webp',
      role,
      joinedOn: null,
      createdAt: '2026-11-08',
      ...extra,
    },
  }
}

beforeEach(() => {
  callApi.mockReset()
  callApi.mockImplementation((route) =>
    Promise.resolve(
      route === 'catalog/classes'
        ? { classes: [{ id: 7, slug: 'mage', name: 'Маг' }] }
        : me.value,
    ),
  )
  signIn.mockReset()
  updateUser.mockReset()
  signOut.mockReset()
  accountLoad.failed = false
  accessState.failed = false
})

describe('account dashboard', () => {
  it('offers sign out and login when account data cannot be loaded', async () => {
    me.value = undefined
    accountLoad.failed = true
    accessState.failed = true
    signOut.mockResolvedValueOnce({ error: null })

    const { router } = await renderApp({ role: 'member', path: '/account' })

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Выйти и перейти ко входу',
      }),
    )

    await waitFor(() => expect(signOut).toHaveBeenCalledOnce())
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
  })

  it('keeps the account open and reports a sign-out error', async () => {
    me.value = undefined
    accountLoad.failed = true
    accessState.failed = true
    signOut.mockRejectedValueOnce(new TypeError('offline'))

    const { router } = await renderApp({ role: 'member', path: '/account' })

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Выйти и перейти ко входу',
      }),
    )

    expect(
      await screen.findByText(
        'Нет связи с сервером. Проверьте интернет и повторите.',
      ),
    ).toBeVisible()
    expect(router.state.location.pathname).toBe('/account')
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeVisible()
  })

  it('shows the applicant status and personal data', async () => {
    me.value = profile('applicant')
    await renderApp({ role: 'applicant', path: '/account' })
    expect(await screen.findByText('Привет, Анна!')).toBeVisible()
    expect(screen.getAllByText('Ожидает проверки офицера')[0]).toBeVisible()
    expect(
      screen.getByText('Заявка получена и ожидает проверки офицером клана.'),
    ).toBeVisible()
    expect(screen.getByText('12.04.1995')).toBeInTheDocument()
  })

  it('shows a reader the profile without the application status', async () => {
    me.value = profile('reader')
    await renderApp({ role: 'reader', path: '/account' })
    expect(
      await screen.findByText('Чтец · доступ только к профилю'),
    ).toBeVisible()
    expect(screen.queryByText(/Заявка получена/)).not.toBeInTheDocument()
    expect(screen.getByText('Смена пароля')).toBeVisible()
  })

  it('prefills the profile form and keeps the email read-only', async () => {
    me.value = profile('member')
    await renderApp({ role: 'member', path: '/account' })
    fireEvent.click(await screen.findByText('Личная информация'))
    fireEvent.click(
      screen.getByRole('button', { name: 'Изменить личную информацию' }),
    )
    expect(screen.getByLabelText('Игровой никнейм')).toHaveValue('Рейна')
    expect(screen.getByLabelText('Город')).toHaveValue('Москва')
    expect(screen.getByLabelText('Электронная почта')).toHaveAttribute(
      'readonly',
    )
  })

  it('removes the avatar on save', async () => {
    me.value = profile('member')
    await renderApp({ role: 'member', path: '/account' })
    fireEvent.click(await screen.findByText('Личная информация'))
    fireEvent.click(
      screen.getByRole('button', { name: 'Изменить личную информацию' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Убрать фото' }))
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить профиль' }))
    await waitFor(() =>
      expect(callApi).toHaveBeenCalledWith(
        'account/update-profile',
        expect.objectContaining({ avatar: { action: 'remove' } }),
      ),
    )
  })

  it('reports password errors next to the fields', async () => {
    me.value = profile('member')
    await renderApp({ role: 'member', path: '/account' })
    await openDetails('Смена пароля')
    const form = screen
      .getByRole('button', { name: 'Изменить пароль' })
      .closest('form')
    if (!form) {
      throw new Error('нет формы')
    }
    fireEvent.change(within(form).getByLabelText('Новый пароль'), {
      target: { value: '1234567' },
    })
    fireEvent.change(within(form).getByLabelText('Повторите новый пароль'), {
      target: { value: 'other' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Изменить пароль' }))
    expect(await screen.findByText('Введите текущий пароль')).toBeVisible()
    expect(screen.getByText('Нужно не менее 8 символов')).toBeVisible()
    expect(screen.getByText('Пароли не совпадают')).toBeVisible()
    expect(signIn).not.toHaveBeenCalled()
  })

  it('rejects a wrong current password and clears fields after success', async () => {
    me.value = profile('member')
    await renderApp({ role: 'member', path: '/account' })
    await openDetails('Смена пароля')
    const fill = (label: string, value: string) =>
      fireEvent.change(screen.getByLabelText(label), { target: { value } })
    fill('Текущий пароль', 'wrong-pass')
    fill('Новый пароль', 'new-password-1')
    fill('Повторите новый пароль', 'new-password-1')
    signIn.mockResolvedValueOnce({ error: { message: 'invalid' } })
    fireEvent.click(screen.getByRole('button', { name: 'Изменить пароль' }))
    expect(
      await screen.findByText('Текущий пароль указан неверно'),
    ).toBeVisible()

    signIn.mockResolvedValueOnce({ error: null })
    updateUser.mockResolvedValueOnce({ error: null })
    fill('Текущий пароль', 'right-pass')
    fireEvent.click(screen.getByRole('button', { name: 'Изменить пароль' }))
    await waitFor(() =>
      expect(updateUser).toHaveBeenCalledWith({ password: 'new-password-1' }),
    )
    await waitFor(() =>
      expect(screen.queryByLabelText('Текущий пароль')).not.toBeInTheDocument(),
    )
  })
})
