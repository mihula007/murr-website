import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

/** Фальшивая вкладка `window.open`: адрес подставляется после ответа сервера. */
function fakeTab() {
  const tab = {
    opener: {} as unknown,
    location: { href: '' },
    close: vi.fn<() => void>(),
  }
  const open = vi
    .spyOn(window, 'open')
    .mockImplementation(() => tab as unknown as Window)
  return { tab, open }
}

beforeEach(() => {
  toast.mockReset()
  me.value = profile('member')
  routes = {
    'telegram/status': () => status(),
    'vk/status': () => status(),
    'max/status': () => status(),
  }
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
afterEach(() => {
  vi.restoreAllMocks()
})

async function section() {
  return within(
    (await screen.findByRole('heading', { name: 'Мессенджеры' })).closest(
      'section',
    )!,
  )
}

describe('messenger links (Q-103)', () => {
  it('is shown to members, officers and admins only', async () => {
    me.value = profile('reader')
    await renderApp({ role: 'reader', path: '/account' })
    expect(await screen.findByText('Привет, Анна!')).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Мессенджеры' })).toBeNull()
    expect(callApi).not.toHaveBeenCalledWith(
      'telegram/status',
      expect.anything(),
    )
  })

  it('shows three logo buttons in one row without help text', async () => {
    await renderApp({ role: 'member', path: '/account' })
    const block = await section()
    for (const name of ['Telegram', 'ВКонтакте', 'MAX']) {
      expect(
        await block.findByRole('button', {
          name: new RegExp(`^Привязать ${name}`),
        }),
      ).toBeEnabled()
    }
    expect(block.queryByText(/Анонсы клана/)).toBeNull()
  })

  it('opens the bot in a new tab with one click', async () => {
    const url = 'https://vk.me/murr?ref=abc'
    routes['vk/link-start'] = () => ({ url, expiresAt: '2026-11-15T12:15:00Z' })
    const { tab, open } = fakeTab()
    await renderApp({ role: 'member', path: '/account' })
    const block = await section()
    fireEvent.click(
      await block.findByRole('button', { name: /^Привязать ВКонтакте/ }),
    )
    // Вкладка открыта сразу в обработчике нажатия, до ответа сервера.
    expect(open).toHaveBeenCalledWith('', '_blank')
    await waitFor(() => expect(tab.location.href).toBe(url))
    expect(tab.opener).toBeNull()
  })

  it('closes the tab and explains a failed link request', async () => {
    routes['max/link-start'] = () => {
      throw new AppError('max_unavailable')
    }
    const { tab } = fakeTab()
    await renderApp({ role: 'member', path: '/account' })
    const block = await section()
    fireEvent.click(
      await block.findByRole('button', { name: /^Привязать MAX/ }),
    )
    await waitFor(() => expect(tab.close).toHaveBeenCalled())
    expect(toast).toHaveBeenCalledWith(
      'MAX не подключён на сервере. Обратитесь к администратору.',
    )
  })

  it('marks a linked messenger and unlinks after confirmation', async () => {
    routes['telegram/status'] = () =>
      status({ linked: true, username: 'anna', displayName: 'Анна' })
    routes['telegram/unlink'] = () => status()
    await renderApp({ role: 'officer', path: '/account' })
    const block = await section()
    fireEvent.click(
      await block.findByRole('button', { name: /^Telegram привязан: @anna/ }),
    )
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/Привязан: @anna/)).toBeVisible()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отвязать' }))
    await waitFor(() => expect(callApi).toHaveBeenCalledWith('telegram/unlink'))
    expect(
      await block.findByRole('button', { name: /^Привязать Telegram/ }),
    ).toBeVisible()
    expect(toast).toHaveBeenCalledWith('Telegram отвязан')
  })

  it('reopens the bot when it was stopped and disables a missing bot', async () => {
    routes['max/status'] = () =>
      status({ linked: true, displayName: 'Анна', blocked: true })
    routes['vk/status'] = () => status({ configured: false })
    routes['max/link-start'] = () => ({
      url: 'https://max.ru/bot?start=x',
      expiresAt: '2026-11-15T12:15:00Z',
    })
    const { tab } = fakeTab()
    await renderApp({ role: 'admin', path: '/account' })
    const block = await section()
    expect(
      await block.findByRole('button', { name: /ВКонтакте пока не подключён/ }),
    ).toBeDisabled()
    fireEvent.click(
      await block.findByRole('button', { name: /^MAX: Бот остановлен/ }),
    )
    await waitFor(() =>
      expect(tab.location.href).toBe('https://max.ru/bot?start=x'),
    )
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })
})
