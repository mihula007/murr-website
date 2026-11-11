import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  EventDetails,
  EventListResponse,
  EventSummary,
  EventTemplate,
} from '@contracts/events'
import { AppError } from '@/lib/errors'
import { formatDateTimeMsk } from '@/lib/format-date'
import { renderApp } from './support/render-app'

const callApi = vi.hoisted(() =>
  vi.fn<(route: string, body?: unknown) => Promise<unknown>>(),
)
const toast = vi.hoisted(() => vi.fn<(message: string) => void>())

vi.mock('@/components/ui/toaster', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast,
}))
vi.mock('@/lib/supabase/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  callApi,
}))

const EVENT_ID = '33333333-3333-4333-8333-333333333333'
const TEMPLATE_ID = '44444444-4444-4444-8444-444444444444'

function summary(extra: Partial<EventSummary> = {}): EventSummary {
  return {
    id: EVENT_ID,
    title: 'Рейд',
    type: 'pve',
    description: 'Собираемся у портала',
    startsAt: '2026-11-14T17:00:00.000Z',
    dateMsk: '2026-11-14',
    timeMsk: '20:00',
    recurring: false,
    createdBy: { gameNickname: 'Офицер' },
    closedAt: null,
    counts: { yes: 2, maybe: 1, no: 0 },
    myAnswer: null,
    canAnswer: true,
    canManage: false,
    ...extra,
  }
}

function details(extra: Partial<EventDetails> = {}): EventDetails {
  return {
    ...summary(),
    participants: [
      {
        id: 'p1',
        gameNickname: 'Анна',
        classId: 8,
        className: 'Воин',
        avatarUrl: null,
        answer: 'yes',
        status: null,
      },
      {
        id: 'p2',
        gameNickname: 'Борис',
        classId: 7,
        className: 'Маг',
        avatarUrl: null,
        answer: null,
        status: null,
      },
    ],
    participantsTruncated: false,
    groups: [],
    canManageGroups: false,
    canClose: false,
    ...extra,
  }
}

function list(
  items: EventSummary[],
  extra: Partial<EventListResponse> = {},
): EventListResponse {
  return {
    items,
    nextCursor: null,
    activeCount: items.length,
    pastCount: 0,
    truncated: false,
    ...extra,
  }
}

function respond(routes: Record<string, (body: unknown) => unknown>) {
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
}

const originalTz = process.env.TZ

beforeEach(() => {
  callApi.mockReset()
  toast.mockReset()
})
afterEach(() => {
  process.env.TZ = originalTz
})

describe('schedule (EVT-01)', () => {
  it('shows events with counts and Moscow time to a member, without management', async () => {
    respond({ 'events/list': () => list([summary()]) })
    await renderApp({ role: 'member', path: '/events' })
    const card = within(
      await screen.findByRole('list', { name: 'Актуальные события' }),
    )
    expect(card.getByText('Рейд')).toBeVisible()
    expect(card.getByText('14.11.2026, 20:00 МСК')).toBeVisible()
    expect(card.getByText('Автор: Офицер')).toBeVisible()
    const counts = within(card.getByRole('list', { name: 'Ответы участников' }))
    expect(counts.getByText(/Приду:/)).toHaveTextContent('Приду: 2')
    expect(screen.queryByText('Создать ивент')).toBeNull()
    expect(screen.queryByText('Постоянные события')).toBeNull()
    expect(card.queryByRole('link', { name: 'Редактировать' })).toBeNull()
  })

  it('offers creation, weekly events and management to an officer', async () => {
    respond({
      'events/list': () =>
        list([
          summary({ canManage: true }),
          summary({
            id: '55555555-5555-4555-8555-555555555555',
            title: 'МТВ',
            recurring: true,
            createdBy: null,
            canManage: true,
          }),
        ]),
      'events/ensure-weekly': () => ({
        created: [],
        existing: ['mtv_sat_20', 'sadik_sat_22', 'tv_sun_20', 'tv_sun_22'],
      }),
    })
    await renderApp({ role: 'officer', path: '/events' })
    expect(
      await screen.findByRole('link', { name: /Создать ивент/ }),
    ).toBeVisible()
    expect(screen.getByText('Автор: Автоматически')).toBeVisible()
    expect(screen.getAllByRole('link', { name: 'Редактировать' })).toHaveLength(
      2,
    )
    fireEvent.click(
      screen.getByRole('button', { name: /Создать постоянные события недели/ }),
    )
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        'Все постоянные события недели уже созданы',
      ),
    )
    expect(callApi).toHaveBeenCalledWith('events/ensure-weekly')
  })

  it('is closed to applicants and readers', async () => {
    for (const role of ['applicant', 'reader'] as const) {
      const view = await renderApp({ role, path: '/events' })
      expect(await screen.findByText('Нет доступа')).toBeVisible()
      view.unmount()
    }
    expect(callApi).not.toHaveBeenCalled()
  })
})

describe('answers (EVT-04, EVT-05, Q-43)', () => {
  it('saves an answer and changes it to another one', async () => {
    let current = summary()
    respond({
      'events/list': () => list([current]),
      'events/respond': (body) => {
        const { answer } = body as { answer: 'yes' | 'maybe' | 'no' }
        current = summary({
          myAnswer: answer,
          counts:
            answer === 'yes'
              ? { yes: 3, maybe: 1, no: 0 }
              : { yes: 2, maybe: 2, no: 0 },
        })
        return current
      },
    })
    await renderApp({ role: 'member', path: '/events' })
    fireEvent.click(await screen.findByRole('button', { name: 'Приду' }))
    expect(await screen.findByText('Ваше решение:')).toBeVisible()
    expect(toast).toHaveBeenCalledWith('Ответ сохранён')
    fireEvent.click(screen.getByRole('button', { name: 'Изменить решение' }))
    fireEvent.click(screen.getByRole('button', { name: '50/50' }))
    await waitFor(() =>
      expect(callApi).toHaveBeenLastCalledWith('events/respond', {
        eventId: EVENT_ID,
        answer: 'maybe',
      }),
    )
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Решение изменено'))
  })

  it('hides answer buttons after the start', async () => {
    respond({
      'events/list': () =>
        list([summary({ canAnswer: false, myAnswer: 'yes' })]),
    })
    await renderApp({ role: 'member', path: '/events' })
    expect(
      await screen.findByText(/Событие началось: ответы больше не принимаются/),
    ).toBeVisible()
    expect(screen.queryByRole('button', { name: '50/50' })).toBeNull()
  })

  it('explains a late answer rejected by the server', async () => {
    respond({
      'events/list': () => list([summary()]),
      'events/respond': () => {
        throw new AppError('state_conflict', { reason: 'started' })
      },
    })
    await renderApp({ role: 'member', path: '/events' })
    fireEvent.click(await screen.findByRole('button', { name: 'Не приду' }))
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        'Событие уже началось: ответы закрыты',
      ),
    )
  })
})

describe('event page (EVT-06)', () => {
  it('lists participants by answer', async () => {
    respond({ 'events/get': () => details() })
    await renderApp({ role: 'member', path: `/events/${EVENT_ID}` })
    expect(
      await screen.findByRole('list', { name: 'Придут' }),
    ).toHaveTextContent('Анна')
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Не отметились/ }))
    expect(
      await screen.findByRole('list', { name: 'Не отметились' }),
    ).toHaveTextContent('Борис')
  })
})

describe('Moscow time display (Q-44)', () => {
  it('does not depend on the browser time zone', () => {
    process.env.TZ = 'America/New_York'
    expect(formatDateTimeMsk('2026-11-14T20:30:00.000Z')).toBe(
      '14.11.2026, 23:30 МСК',
    )
    process.env.TZ = 'Asia/Vladivostok'
    expect(formatDateTimeMsk('2026-11-14T22:00:00.000Z')).toBe(
      '15.11.2026, 01:00 МСК',
    )
  })
})

describe('event form and templates (EVT-03, EVT-11–13)', () => {
  const template: EventTemplate = {
    id: TEMPLATE_ID,
    title: 'Осада',
    type: 'pvp',
    description: 'Сбор у ворот',
    weekday: 6,
    time: '20:00',
    createdBy: { gameNickname: 'Офицер' },
  }

  it('shows required fields and does not send an empty event', async () => {
    respond({ 'events/templates': () => ({ items: [] }) })
    await renderApp({ role: 'officer', path: '/events/new' })
    const form = within(
      await screen.findByRole('form', { name: 'Новое событие' }),
    )
    fireEvent.click(form.getByRole('button', { name: 'Создать ивент' }))
    await waitFor(() =>
      expect(form.getAllByText('Заполните поле').length).toBeGreaterThanOrEqual(
        4,
      ),
    )
    expect(callApi).not.toHaveBeenCalledWith('events/create', expect.anything())
  })

  it('fills the form from a template without creating an event', async () => {
    respond({
      'events/templates': () => ({ items: [template] }),
      'events/template-next': () => ({ date: '2026-11-14', time: '20:00' }),
    })
    await renderApp({ role: 'officer', path: '/events/new' })
    fireEvent.click(
      await screen.findByRole('button', { name: 'Заполнить ближайшую дату' }),
    )
    await waitFor(() =>
      expect(screen.getByLabelText('Название')).toHaveValue('Осада'),
    )
    expect(screen.getByLabelText('Дата (МСК)')).toHaveValue('2026-11-14')
    expect(screen.getByLabelText('Время (МСК)')).toHaveValue('20:00')
    expect(callApi).not.toHaveBeenCalledWith('events/create', expect.anything())
  })

  it('creates an event with Moscow date and time', async () => {
    respond({
      'events/templates': () => ({ items: [] }),
      'events/create': () => details({ canManage: true }),
      'events/list': () => list([summary({ canManage: true })]),
    })
    await renderApp({ role: 'admin', path: '/events/new' })
    const form = within(
      await screen.findByRole('form', { name: 'Новое событие' }),
    )
    fireEvent.change(form.getByLabelText('Название'), {
      target: { value: 'Рейд' },
    })
    fireEvent.change(form.getByLabelText('Дата (МСК)'), {
      target: { value: '2026-11-14' },
    })
    fireEvent.change(form.getByLabelText('Время (МСК)'), {
      target: { value: '20:00' },
    })
    fireEvent.change(form.getByLabelText('Описание'), {
      target: { value: 'Собираемся у портала' },
    })
    fireEvent.click(form.getByRole('button', { name: 'Создать ивент' }))
    await waitFor(() =>
      expect(callApi).toHaveBeenCalledWith('events/create', {
        title: 'Рейд',
        type: 'pve',
        date: '2026-11-14',
        time: '20:00',
        description: 'Собираемся у портала',
      }),
    )
    expect(
      await screen.findByRole('list', { name: 'Актуальные события' }),
    ).toBeVisible()
  })

  it('asks before deleting a template', async () => {
    respond({
      'events/templates': () => ({ items: [template] }),
      'events/template-delete': () => ({ items: [] }),
    })
    await renderApp({ role: 'officer', path: '/events/new' })
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить' }))
    const dialog = within(await screen.findByRole('alertdialog'))
    expect(callApi).not.toHaveBeenCalledWith(
      'events/template-delete',
      expect.anything(),
    )
    fireEvent.click(dialog.getByRole('button', { name: 'Удалить' }))
    await waitFor(() =>
      expect(callApi).toHaveBeenCalledWith('events/template-delete', {
        id: TEMPLATE_ID,
      }),
    )
  })
})
