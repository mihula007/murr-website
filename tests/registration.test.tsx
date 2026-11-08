import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { targetSize } from '@/features/auth/compress-avatar'
import {
  loadDraft,
  saveDraft,
  setPendingAvatar,
} from '@/features/auth/registration-draft'
import { renderApp } from './support/render-app'

const signUp = vi.hoisted(() => vi.fn<(input: unknown) => Promise<unknown>>())

vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  callApi: (route: string) =>
    Promise.resolve(
      route === 'catalog/classes'
        ? { classes: [{ id: 7, slug: 'mage', name: 'Маг' }] }
        : { available: true },
    ),
}))

vi.mock('@/features/auth/supabase-auth', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requireSupabase: () => ({ auth: { signUp } }),
}))

vi.mock('@/features/auth/session', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSession: () => ({ status: 'signedOut', session: null }),
}))

const validDraft = {
  email: 'anna@example.com',
  displayName: 'Анна',
  gameNickname: 'Рейна',
  city: 'Москва',
  birthDate: '1995-04-12',
  classId: 7,
  about: 'Играю давно',
  equipmentLinks: [],
}

beforeEach(() => {
  sessionStorage.clear()
  setPendingAvatar(null)
  signUp.mockReset()
})

function change(label: RegExp | string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

describe('avatar sizing', () => {
  it.each([
    [2048, 1024, 512, 256],
    [300, 900, 171, 512],
    [200, 100, 200, 100],
  ])('%i×%i → %i×%i without upscaling', (w, h, ew, eh) => {
    expect(targetSize(w, h)).toEqual({ width: ew, height: eh })
  })
})

describe('registration form', () => {
  it('shows field errors for limits and a missing avatar', async () => {
    await renderApp({ path: '/register' })
    change('Логин (электронная почта)', 'anna@example.com')
    change(/^Пароль$/, '1234567')
    change('Имя', 'Тринадцать133')
    change('Игровой никнейм', 'Десятьсимв')
    fireEvent.click(
      screen.getByRole('button', { name: 'Создать учётную запись' }),
    )
    expect(await screen.findByText('Нужно не менее 8 символов')).toBeVisible()
    expect(screen.getAllByText('Слишком длинное значение')).toHaveLength(2)
    expect(document.getElementById('reg-avatar-error')?.textContent).toBe(
      'Заполните поле',
    )
    expect(signUp).not.toHaveBeenCalled()
  })

  it('keeps a draft in the tab without the password', async () => {
    await renderApp({ path: '/register' })
    change('Логин (электронная почта)', 'anna@example.com')
    change(/^Пароль$/, 'secret-password')
    await waitFor(() => expect(loadDraft()?.email).toBe('anna@example.com'))
    expect(JSON.stringify(loadDraft())).not.toContain('secret-password')
  })

  it('sends an existing email to sign-in without creating anything', async () => {
    saveDraft(validDraft)
    setPendingAvatar(new Blob(['x'], { type: 'image/png' }))
    signUp.mockResolvedValue({
      data: { user: { identities: [] } },
      error: null,
    })
    const { router } = await renderApp({ path: '/register' })
    change(/^Пароль$/, 'long-enough-1')
    fireEvent.click(
      screen.getByRole('button', { name: 'Создать учётную запись' }),
    )
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(router.state.location.search).toEqual({ email: 'anna@example.com' })
  })

  it('moves to the code screen after a new sign-up', async () => {
    saveDraft(validDraft)
    setPendingAvatar(new Blob(['x'], { type: 'image/png' }))
    signUp.mockResolvedValue({
      data: { user: { identities: [{ id: '1' }] } },
      error: null,
    })
    const { router } = await renderApp({ path: '/register' })
    change(/^Пароль$/, 'long-enough-1')
    fireEvent.click(
      screen.getByRole('button', { name: 'Создать учётную запись' }),
    )
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/register/verify'),
    )
    expect(signUp).toHaveBeenCalledWith({
      email: 'anna@example.com',
      password: 'long-enough-1',
    })
  })
})
