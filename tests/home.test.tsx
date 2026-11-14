import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { formatMonth } from '@/lib/format-date'
import { eventsLabel } from '@/features/home/plural'
import { renderApp } from './support/render-app'

const callApi = vi.hoisted(() =>
  vi.fn<(route: string, body?: unknown) => Promise<unknown>>(),
)

vi.mock('@/lib/supabase/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  callApi,
}))

const event = (id: string, title: string) => ({
  id,
  title,
  type: 'pve',
  description: 'Описание',
  startsAt: '2099-11-14T17:00:00.000Z',
  dateMsk: '2099-11-14',
  timeMsk: '20:00',
  recurring: false,
  createdBy: { gameNickname: 'Officer' },
  closedAt: null,
  counts: { yes: 1, maybe: 0, no: 0 },
  myAnswer: null,
  canAnswer: true,
  canManage: false,
  messageCount: 0,
})

const member = (id: string, nick: string, role: string) => ({
  id,
  gameNickname: nick,
  classId: 1,
  className: 'Воин',
  avatarUrl: null,
  role,
})

let responses: Record<string, unknown>

beforeEach(() => {
  callApi.mockReset()
  responses = {
    'roster/count': { count: 12 },
    'notifications/summary': { unreadCount: 0, sections: {} },
    'events/list': {
      items: [
        event('e1', 'Рейд 1'),
        event('e2', 'Рейд 2'),
        event('e3', 'Рейд 3'),
        event('e4', 'Рейд 4'),
      ],
      nextCursor: null,
      activeCount: 4,
      pastCount: 0,
      truncated: false,
    },
    'activity/month-top': {
      month: '2026-11',
      eventCount: 2,
      items: [
        {
          userId: 'u1',
          gameNickname: 'Лидер',
          classId: 1,
          className: 'Воин',
          visited: 2,
          total: 2,
          percent: 100,
          leaderCount: 1,
        },
      ],
    },
    'roster/list': {
      items: [
        member('a1', 'Админ', 'admin'),
        member('o1', 'Офицер', 'officer'),
        member('m1', 'Член1', 'member'),
        member('m2', 'Член2', 'member'),
      ],
      truncated: false,
    },
  }
  callApi.mockImplementation((route) =>
    route in responses
      ? Promise.resolve(structuredClone(responses[route]))
      : new Promise(() => {}),
  )
})

const calledRoutes = () => callApi.mock.calls.map(([route]) => route)

describe('главная внутренних ролей (HOM-07–09, ACT-12, ROS-08)', () => {
  it('без событий предлагает расписание, офицеру — создание', async () => {
    responses['events/list'] = { items: [], nextCursor: null, activeCount: 0 }
    await renderApp({ role: 'officer' })
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Ближайших событий нет',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /Создать событие/ }),
    ).toHaveAttribute('href', '/events/new')
    expect(
      screen.queryByRole('region', { name: 'Дальше в расписании' }),
    ).not.toBeInTheDocument()
  })

  it('член видит ближайшее событие с ответом, ещё три, число актуальных, топ и краткий состав', async () => {
    await renderApp({ role: 'member' })
    const hero = await screen.findByRole('region', {
      name: 'Ближайшее событие',
    })
    expect(
      await within(hero).findByRole('heading', { level: 1, name: 'Рейд 1' }),
    ).toBeInTheDocument()
    expect(
      within(hero).getByRole('group', { name: 'Ваше решение' }),
    ).toBeInTheDocument()
    expect(
      within(hero).getByText('12 участников в клане, 4 события скоро.'),
    ).toBeInTheDocument()
    const later = screen.getByRole('region', { name: 'Дальше в расписании' })
    for (const title of ['Рейд 2', 'Рейд 3', 'Рейд 4']) {
      expect(
        within(later).getByRole('link', { name: new RegExp(title) }),
      ).toBeInTheDocument()
    }
    expect(within(later).queryByText('Рейд 1')).not.toBeInTheDocument()

    const top = screen.getByRole('region', {
      name: 'Топ-5 посещаемости за месяц',
    })
    expect(await within(top).findByText('Лидер')).toBeInTheDocument()
    expect(within(top).getByText('ноябрь 2026')).toBeInTheDocument()
    expect(
      within(top).queryByRole('link', { name: /Весь учёт/ }),
    ).not.toBeInTheDocument()

    expect(
      await screen.findByText('Админ', { selector: 'strong' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Офицер', { selector: 'strong' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Член1')).not.toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /К голосованиям/ }),
    ).toHaveAttribute('href', '/votes')
  })

  it('офицер и администратор видят «Весь учёт»', async () => {
    await renderApp({ role: 'officer' })
    const top = await screen.findByRole('region', {
      name: 'Топ-5 посещаемости за месяц',
    })
    expect(
      await within(top).findByRole('link', { name: /Весь учёт/ }),
    ).toHaveAttribute('href', '/activity')
  })

  it('без закрытых событий месяца — сообщение вместо лидеров (ACT-13)', async () => {
    responses['activity/month-top'] = {
      month: '2026-11',
      eventCount: 0,
      items: [],
    }
    await renderApp({ role: 'member' })
    expect(await screen.findByText('Пока нет данных')).toBeInTheDocument()
  })

  it.each(['guest', 'applicant', 'reader'] as const)(
    'роль %s не видит состав, события и топ (HOM-04, HOM-11)',
    async (role) => {
      await renderApp({ role })
      await screen.findByText('Легенда продолжается', { exact: false })
      expect(
        screen.queryByRole('region', { name: 'Ближайшее событие' }),
      ).not.toBeInTheDocument()
      expect(screen.queryByText('Состав клана')).not.toBeInTheDocument()
      for (const route of [
        'roster/list',
        'events/list',
        'activity/month-top',
      ]) {
        expect(calledRoutes()).not.toContain(route)
      }
    },
  )
})

describe('подписи главной', () => {
  it('склоняет число событий и пишет месяц словами', () => {
    expect([1, 2, 5, 11, 22].map(eventsLabel)).toEqual([
      'событие скоро',
      'события скоро',
      'событий скоро',
      'событий скоро',
      'события скоро',
    ])
    expect(formatMonth('2026-01')).toBe('январь 2026')
    expect(formatMonth('2026-12')).toBe('декабрь 2026')
  })
})
