import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { notificationRoute } from '@/features/notifications/notification-target'
import { renderApp } from './support/render-app'

const callApi = vi.hoisted(() =>
  vi.fn<(route: string, body?: unknown) => Promise<unknown>>(),
)

vi.mock('@/lib/supabase/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  callApi,
}))

const responses: Record<string, unknown> = {}

beforeEach(() => {
  callApi.mockReset()
  for (const key of Object.keys(responses)) {
    delete responses[key]
  }
  Object.assign(responses, {
    'notifications/summary': {
      unreadCount: 2,
      sections: { events: 3, votes: 0, publications: 0, market: 0 },
    },
    'notifications/list': {
      unreadCount: 2,
      items: [
        {
          id: 'n1',
          kind: 'group_added',
          title: 'Вы добавлены в группу',
          body: 'Рейд · Пати 1',
          target: { kind: 'event', id: 'e1' },
          createdAt: '2026-11-13T09:00:00.000Z',
          readAt: null,
        },
        {
          id: 'n2',
          kind: 'role_changed',
          title: 'Ваша роль изменена',
          body: 'Член клана → Офицер',
          target: { kind: 'account', id: 'u1' },
          createdAt: '2026-11-12T09:00:00.000Z',
          readAt: '2026-11-12T10:00:00.000Z',
        },
      ],
    },
    'notifications/read': { unreadCount: 1 },
    'notifications/read-all': { unreadCount: 0 },
    'notifications/section-seen': { ok: true },
    'events/list': {
      items: [],
      nextCursor: null,
      activeCount: 0,
      pastCount: 0,
      truncated: false,
    },
  })
  // Остальные запросы страниц в этих тестах не важны: ответа нет.
  callApi.mockImplementation((route) =>
    route in responses
      ? Promise.resolve(structuredClone(responses[route]))
      : new Promise(() => {}),
  )
})

const bell = () => screen.findByRole('button', { name: /^Уведомления/ })

describe('колокольчик (NTF-01, NTF-02, NTF-05)', () => {
  it.each(['guest', 'reader'] as const)(
    'роль %s не видит колокольчик и не опрашивает сервер',
    async (role) => {
      await renderApp({ role })
      await screen.findByRole('banner')
      expect(
        screen.queryByRole('button', { name: /^Уведомления/ }),
      ).not.toBeInTheDocument()
      expect(callApi).not.toHaveBeenCalledWith(
        'notifications/summary',
        expect.anything(),
      )
      expect(callApi.mock.calls.map(([route]) => route)).not.toContain(
        'notifications/summary',
      )
    },
  )

  it('кандидат видит колокольчик', async () => {
    responses['notifications/summary'] = { unreadCount: 0, sections: {} }
    await renderApp({ role: 'applicant' })
    expect(await bell()).toHaveAccessibleName('Уведомления')
  })

  it('значок показывает «99+» свыше 99 непрочитанных', async () => {
    responses['notifications/summary'] = { unreadCount: 150, sections: {} }
    await renderApp({ role: 'member' })
    await waitFor(async () =>
      expect(await bell()).toHaveAccessibleName(
        'Уведомления, непрочитанных: больше 99',
      ),
    )
    expect(within(await bell()).getByText('99+')).toBeInTheDocument()
  })

  it('открытие панели не прочитывает; нажатие отмечает одну и ведёт к объекту', async () => {
    const { router } = await renderApp({ role: 'member' })
    fireEvent.click(await bell())
    const item = await screen.findByRole('button', {
      name: /Вы добавлены в группу/,
    })
    expect(callApi.mock.calls.map(([route]) => route)).not.toContain(
      'notifications/read',
    )
    expect(callApi.mock.calls.map(([route]) => route)).not.toContain(
      'notifications/read-all',
    )
    fireEvent.click(item)
    await waitFor(() =>
      expect(callApi).toHaveBeenCalledWith('notifications/read', { id: 'n1' }),
    )
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/events/e1'),
    )
  })

  it('«Прочитать все» — одним вызовом', async () => {
    await renderApp({ role: 'member' })
    fireEvent.click(await bell())
    await screen.findByRole('button', { name: /Вы добавлены в группу/ })
    fireEvent.click(screen.getByRole('button', { name: 'Прочитать все' }))
    await waitFor(() =>
      expect(callApi).toHaveBeenCalledWith('notifications/read-all'),
    )
  })

  it('пустая история — понятное состояние (NTF-07)', async () => {
    responses['notifications/list'] = { unreadCount: 0, items: [] }
    await renderApp({ role: 'member' })
    fireEvent.click(await bell())
    expect(await screen.findByText('Уведомлений пока нет.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Прочитать все' })).toBeDisabled()
  })
})

describe('счётчики разделов (NTF-09–11)', () => {
  it('категория показывает сумму, открытие раздела снимает его новизну', async () => {
    await renderApp({ role: 'member' })
    const nav = screen.getByRole('navigation', { name: 'Основная навигация' })
    const clan = await within(nav).findByRole('button', { name: /Клан/ })
    await waitFor(() => expect(within(clan).getByText('3')).toBeInTheDocument())
    expect(callApi.mock.calls.map(([route]) => route)).not.toContain(
      'notifications/section-seen',
    )
  })

  it('открытый раздел с новыми объектами отмечается просмотренным', async () => {
    await renderApp({ role: 'member', path: '/events' })
    await waitFor(() =>
      expect(callApi).toHaveBeenCalledWith('notifications/section-seen', {
        section: 'events',
      }),
    )
  })
})

describe('переход по уведомлению (NTF-06, NTF-07)', () => {
  it('ведёт к объекту по виду ссылки и роли', () => {
    expect(notificationRoute({ kind: 'vote', id: 'v1' }, 'member')).toEqual({
      to: '/votes/$id',
      params: { id: 'v1' },
    })
    expect(
      notificationRoute({ kind: 'market_listing', id: 'm1' }, 'member'),
    ).toEqual({ to: '/market/$id', params: { id: 'm1' } })
    expect(
      notificationRoute({ kind: 'join_application', id: 'a1' }, 'applicant'),
    ).toEqual({ to: '/account' })
    expect(
      notificationRoute({ kind: 'join_application', id: 'a1' }, 'officer'),
    ).toEqual({ to: '/applications/$id', params: { id: 'a1' } })
    expect(notificationRoute({ kind: 'unknown', id: 'x' }, 'member')).toBe(null)
    expect(notificationRoute(null, 'member')).toBe(null)
  })
})
