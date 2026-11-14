import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TelegramStatus } from '@contracts/telegram'
import { AppError } from '@/lib/errors'
import { renderApp } from './support/render-app'

const me = vi.hoisted(() => ({ value: {} as unknown }))
const callApi = vi.hoisted(() =>
  vi.fn<(route: string, body?: unknown) => Promise<unknown>>(),
)
vi.mock('@/features/account/use-me', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useMe: () => ({
    data: me.value,
    isPending: false,
    isError: false,
    refetch: vi.fn<() => void>(),
  }),
}))
vi.mock('@/lib/supabase/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  callApi,
}))
const toast = vi.hoisted(() => vi.fn<(message: string) => void>())
vi.mock('@/components/ui/toaster', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast,
}))

type Handler = (body: unknown) => unknown
let routes: Record<string, Handler> = {}

function profile(role: string) {
  return {
    state: 'ready',
    email: 'anna@example.com',
    application: null,
    canResubmit: false,
    profile: {
      id: 'u1',
      displayName: 'Анна',
      gameNickname: 'Рейна',
      city: null,
      birthDate: '1995-04-12',
      classId: 7,
      className: 'Маг',
      about: null,
      avatarUrl: null,
      role,
      joinedOn: '2026-11-01',
      createdAt: '2026-11-08',
    },
  }
}

const status = (extra: Partial<TelegramStatus> = {}): TelegramStatus => ({
  configured: true,
  linked: false,
  username: null,
  displayName: null,
  blocked: false,
  ...extra,
})

beforeEach(() => {
  toast.mockReset()
  me.value = profile('member')
  routes = { 'telegram/status': () => status() }
  callApi.mockReset()
  callApi.mockImplementation((route, body) => {
    const handler = routes[route]
    if (!handler) {
      return Promise.reject(new AppError('not_found'))
    }
    try {
      return Promise.resolve(handler(body))
    } catch (error) {
      return Promise.reject(error)
    }
  })
})

async function card() {
  return within(
    (await screen.findByRole('heading', { name: 'Telegram' })).closest(
      'section',
    )!,
  )
}

describe('telegram link card (TGM-01–TGM-08)', () => {
  it('is shown to members, officers and admins only (Q-88)', async () => {
    me.value = profile('reader')
    await renderApp({ role: 'reader', path: '/account' })
    expect(await screen.findByText('Привет, Анна!')).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Telegram' })).toBeNull()
    expect(callApi).not.toHaveBeenCalledWith(
      'telegram/status',
      expect.anything(),
    )
  })

  it('gives a one-time bot link as a plain link', async () => {
    const url = 'https://t.me/murr_test_bot?start=abc'
    routes['telegram/link-start'] = () => ({
      url,
      expiresAt: '2026-11-14T12:15:00Z',
    })
    await renderApp({ role: 'member', path: '/account' })
    const block = await card()
    fireEvent.click(
      await block.findByRole('button', { name: 'Привязать Telegram' }),
    )
    const link = await block.findByRole('link', { name: 'Открыть бота' })
    expect(link).toHaveAttribute('href', url)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(
      block.getByText(/Ссылка одноразовая и действует 15 минут/),
    ).toBeVisible()
  })

  it('shows the linked account and unlinks after confirmation', async () => {
    routes['telegram/status'] = () =>
      status({ linked: true, username: 'anna', displayName: 'Анна' })
    routes['telegram/unlink'] = () => status()
    await renderApp({ role: 'officer', path: '/account' })
    const block = await card()
    expect(await block.findByText('@anna')).toBeVisible()
    fireEvent.click(block.getByRole('button', { name: 'Отвязать' }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отвязать' }))
    await waitFor(() => expect(callApi).toHaveBeenCalledWith('telegram/unlink'))
    expect(
      await block.findByRole('button', { name: 'Привязать Telegram' }),
    ).toBeVisible()
    expect(toast).toHaveBeenCalledWith('Telegram отвязан')
  })

  it('explains a stopped bot and a missing server bot', async () => {
    routes['telegram/status'] = () =>
      status({ linked: true, displayName: 'Анна', blocked: true })
    await renderApp({ role: 'admin', path: '/account' })
    const block = await card()
    expect(await block.findByText(/Бот остановлен в Telegram/)).toBeVisible()
    expect(block.getByText('Анна')).toBeVisible()
  })

  it('says when the server has no bot', async () => {
    routes['telegram/status'] = () => status({ configured: false })
    await renderApp({ role: 'member', path: '/account' })
    const block = await card()
    expect(await block.findByText(/Telegram пока не подключён/)).toBeVisible()
    expect(block.queryByRole('button')).toBeNull()
  })
})
