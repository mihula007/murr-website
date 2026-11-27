import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import type { EventDetails, EventParticipant } from '@contracts/events'
import type {
  EventGroup,
  GroupTemplateCatalogResponse,
} from '@contracts/groups'
import { finalPosition } from '@/features/events/groups/event-groups'
import { AppError } from '@/lib/errors'
import { renderApp } from './support/render-app'

const callApi = vi.hoisted(() =>
  vi.fn<(route: string, body?: unknown) => Promise<unknown>>(),
)
const toast = vi.hoisted(() => vi.fn<(message: string) => void>())
const sessionUserId = vi.hoisted(() => ({ current: null as string | null }))

// jsdom не вычисляет высоту прокручиваемой области из CSS-классов; задаём
// размеры, чтобы TanStack Virtual мог отрисовать видимые строки.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => 600,
  })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 800,
  })
  HTMLElement.prototype.scrollIntoView = vi.fn<HTMLElement['scrollIntoView']>()
})

afterAll(() => {
  Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight')
  Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth')
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
})

vi.mock('@/components/ui/toaster', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast,
}))
vi.mock('@/lib/supabase/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  callApi,
}))
vi.mock('@/features/auth/session', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSession: () =>
    sessionUserId.current
      ? {
          status: 'signedIn',
          session: { user: { id: sessionUserId.current } },
        }
      : { status: 'unavailable', session: null },
}))

const EVENT_ID = '33333333-3333-4333-8333-333333333333'
const GROUP_ID = '55555555-5555-4555-8555-555555555555'
const ANNA = '66666666-6666-4666-8666-666666666661'
const BORIS = '66666666-6666-4666-8666-666666666662'
const CLASS_CATALOG = {
  classes: [
    { id: 7, slug: 'mage', name: 'Маг' },
    { id: 8, slug: 'warrior', name: 'Воин' },
  ],
}

const ANNA_ROSTER = {
  id: ANNA,
  gameNickname: 'Анна',
  classId: 7,
  className: 'Маг',
  avatarUrl: null,
  role: 'member' as const,
  pa: 125,
  pz: 80,
  bu: null,
  hp: 1000,
  bd: 25,
}

function person(
  id: string,
  gameNickname: string,
  extra: Partial<EventParticipant> = {},
): EventParticipant {
  return {
    id,
    gameNickname,
    classId: 7,
    className: 'Маг',
    avatarUrl: null,
    answer: 'yes',
    status: null,
    ...extra,
  }
}

function details(extra: Partial<EventDetails> = {}): EventDetails {
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
    counts: { yes: 1, maybe: 0, no: 0 },
    myAnswer: null,
    canAnswer: true,
    canManage: false,
    participants: [
      person(ANNA, 'Анна'),
      person(BORIS, 'Борис', { answer: null }),
    ],
    participantsTruncated: false,
    groups: [],
    canManageGroups: false,
    canClose: false,
    ...extra,
  }
}

const group = (members: EventGroup['members'] = []): EventGroup => ({
  id: GROUP_ID,
  name: 'Пати 1',
  members,
})

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

const manager = (extra: Partial<EventDetails> = {}) =>
  details({ canManageGroups: true, canClose: true, ...extra })

beforeEach(() => {
  callApi.mockReset()
  toast.mockReset()
  sessionUserId.current = null
})

describe('event groups: reading (GRP-01, GRP-16)', () => {
  it('keeps wrapped group rows close together', async () => {
    respond({
      'events/get': () =>
        details({
          groups: [
            group(),
            { ...group(), id: '55555555-5555-4555-8555-555555555556' },
          ],
        }),
    })
    await renderApp({ role: 'officer', path: `/events/${EVENT_ID}` })
    const groups = await screen.findByRole('list', { name: 'Группы события' })
    expect(groups).toHaveClass(/content-start/)
  })

  it('highlights the current participant in the free pool and group', async () => {
    sessionUserId.current = ANNA
    respond({
      'events/get': () =>
        details({
          participants: [person(ANNA, 'Анна'), person(BORIS, 'Борис')],
        }),
    })
    const { unmount } = await renderApp({
      role: 'officer',
      path: `/events/${EVENT_ID}`,
    })
    const pool = await screen.findByRole('list', { name: 'Придут' })
    const annaInPool = within(pool).getByText('Анна').closest('li')!
    const borisInPool = within(pool).getByText('Борис').closest('li')!
    expect(annaInPool).toHaveClass(/bg-item-highlight!?/)
    expect(borisInPool).not.toHaveClass(/bg-item-highlight!?/)

    unmount()
    respond({
      'events/get': () =>
        details({ groups: [group([{ userId: ANNA, isLeader: false }])] }),
    })
    await renderApp({ role: 'member', path: `/events/${EVENT_ID}` })
    const members = await screen.findByRole('list', {
      name: 'Состав «Пати 1»',
    })
    expect(within(members).getByText('Анна').closest('li')).toHaveClass(
      /bg-item-highlight!?/,
    )
    sessionUserId.current = null
  })

  it('shows groups to a member without any management', async () => {
    respond({
      'events/get': () =>
        details({ groups: [group([{ userId: ANNA, isLeader: true }])] }),
    })
    await renderApp({ role: 'member', path: `/events/${EVENT_ID}` })
    const members = await screen.findByRole('list', { name: 'Состав «Пати 1»' })
    expect(members).toHaveTextContent('Анна — ПЛ')
    // Назначенный скрыт из свободного списка (GRP-01).
    expect(screen.queryByRole('list', { name: 'Придут' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Создать группу' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Перетащить/ })).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'Завершить событие' }),
    ).toBeNull()
  })

  it('shows the closing result read-only (ACT-01, GRP-16)', async () => {
    respond({
      'events/get': () =>
        manager({
          canManageGroups: false,
          canClose: false,
          canAnswer: false,
          closedAt: '2026-11-14T20:00:00.000Z',
          participants: [
            person(ANNA, 'Анна', { status: 'visited' }),
            person(BORIS, 'Борис', { answer: null, status: 'unmarked' }),
          ],
          groups: [group([{ userId: ANNA, isLeader: false }])],
        }),
    })
    await renderApp({ role: 'officer', path: `/events/${EVENT_ID}` })
    expect(
      await screen.findByRole('list', { name: 'Посетили' }),
    ).toHaveTextContent('Анна')
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Не отметились/ }))
    expect(
      await screen.findByRole('list', { name: 'Не отметились' }),
    ).toHaveTextContent('Борис')
    expect(screen.queryByRole('button', { name: 'Создать группу' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Действия/ })).toBeNull()
  })
})

describe('event groups: management (GRP-03–10)', () => {
  it('creates a group through the form and rejects an empty name', async () => {
    respond({
      'events/get': () => manager(),
      'groups/create': () => ({ groups: [group()] }),
    })
    await renderApp({ role: 'officer', path: `/events/${EVENT_ID}` })
    fireEvent.click(
      await screen.findByRole('button', { name: 'Создать группу' }),
    )
    const dialog = within(await screen.findByRole('dialog'))
    fireEvent.click(dialog.getByRole('button', { name: 'Создать' }))
    expect(await dialog.findByText('Заполните поле')).toBeVisible()
    expect(callApi).not.toHaveBeenCalledWith('groups/create', expect.anything())

    fireEvent.change(dialog.getByLabelText('Название группы'), {
      target: { value: 'Пати 1' },
    })
    fireEvent.click(dialog.getByRole('button', { name: 'Создать' }))
    await waitFor(() =>
      expect(callApi).toHaveBeenCalledWith('groups/create', {
        eventId: EVENT_ID,
        name: 'Пати 1',
      }),
    )
    expect(await screen.findByRole('heading', { name: /Пати 1/ })).toBeVisible()
  })

  it('moves a member into a group from the row menu (GRP-04, GRP-05)', async () => {
    respond({
      'events/get': () => manager({ groups: [group()] }),
      'groups/move': () => ({
        groups: [group([{ userId: ANNA, isLeader: false }])],
      }),
    })
    await renderApp({ role: 'officer', path: `/events/${EVENT_ID}` })
    const trigger = await screen.findByRole('button', {
      name: 'Действия: Анна',
    })
    fireEvent.keyDown(trigger, { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Пати 1' }))
    await waitFor(() =>
      expect(callApi).toHaveBeenCalledWith('groups/move', {
        eventId: EVENT_ID,
        userId: ANNA,
        groupId: GROUP_ID,
        position: null,
      }),
    )
    expect(
      await screen.findByRole('list', { name: 'Состав «Пати 1»' }),
    ).toHaveTextContent('Анна')
  })

  it('does not copy nicknames of an empty group (GRP-10)', async () => {
    respond({ 'events/get': () => manager({ groups: [group()] }) })
    await renderApp({ role: 'officer', path: `/events/${EVENT_ID}` })
    fireEvent.click(await screen.findByRole('button', { name: /ники/i }))
    expect(toast).toHaveBeenCalledWith('В группе никого нет: копировать нечего')
  })

  it('explains a change rejected because the event was closed', async () => {
    respond({
      'events/get': () => manager({ groups: [group()] }),
      'groups/move': () => {
        throw new AppError('state_conflict', { reason: 'closed' })
      },
    })
    await renderApp({ role: 'officer', path: `/events/${EVENT_ID}` })
    const trigger = await screen.findByRole('button', {
      name: 'Действия: Анна',
    })
    fireEvent.keyDown(trigger, { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Пати 1' }))
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        'Событие уже закрыто: группы больше не меняются',
      ),
    )
  })
})

describe('closing (EVT-08)', () => {
  it('asks for confirmation, warns without groups and closes', async () => {
    respond({
      'events/get': () => manager(),
      'events/close': () =>
        manager({
          canManageGroups: false,
          canClose: false,
          closedAt: '2026-11-14T20:00:00.000Z',
        }),
    })
    await renderApp({ role: 'officer', path: `/events/${EVENT_ID}` })
    fireEvent.click(
      await screen.findByRole('button', { name: 'Завершить событие' }),
    )
    const dialog = within(await screen.findByRole('alertdialog'))
    expect(
      dialog.getByText('Групп нет: никто не получит «Посетил».'),
    ).toBeVisible()
    expect(callApi).not.toHaveBeenCalledWith('events/close', expect.anything())
    fireEvent.click(dialog.getByRole('button', { name: 'Завершить' }))
    await waitFor(() =>
      expect(callApi).toHaveBeenCalledWith('events/close', { id: EVENT_ID }),
    )
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Завершить событие' }),
      ).toBeNull(),
    )
  })
})

describe('group templates (GRP-12, GRP-15)', () => {
  const templates: GroupTemplateCatalogResponse = {
    items: [
      {
        id: '77777777-7777-4777-8777-777777777777',
        name: 'Основа',
        createdBy: { gameNickname: 'Офицер' },
        groupCount: 1,
        memberCount: 1,
      },
    ],
  }

  it('asks before replacing existing groups with a template', async () => {
    respond({
      'events/get': () => manager({ groups: [group()] }),
      'group-templates/catalog': () => templates,
      'group-templates/apply': () => ({ groups: [group()] }),
    })
    await renderApp({ role: 'officer', path: `/events/${EVENT_ID}` })
    fireEvent.click(
      await screen.findByRole('button', { name: 'Шаблоны групп' }),
    )
    const library = within(await screen.findByRole('dialog'))
    expect(await library.findByText(/1 из 20/)).toBeVisible()
    fireEvent.click(await library.findByRole('button', { name: 'Применить' }))
    const confirm = within(await screen.findByRole('alertdialog'))
    expect(callApi).not.toHaveBeenCalledWith(
      'group-templates/apply',
      expect.anything(),
    )
    fireEvent.click(confirm.getByRole('button', { name: 'Заменить группы' }))
    await waitFor(() =>
      expect(callApi).toHaveBeenCalledWith('group-templates/apply', {
        eventId: EVENT_ID,
        templateId: templates.items[0]!.id,
      }),
    )
  })

  it('loads and updates a shared template in place; cancel leaves it unchanged', async () => {
    const templateId = templates.items[0]!.id
    let name = 'Основа'
    const detail = {
      id: templateId,
      name: 'Основа',
      createdBy: { gameNickname: 'Офицер' },
      groups: [
        {
          name: 'Передовая',
          members: [
            {
              userId: ANNA,
              gameNickname: 'Анна',
              classId: 7,
              className: 'Маг',
              isLeader: true,
              pa: 125,
              pz: 80,
              bu: null,
              hp: 1000,
              bd: 25,
            },
          ],
        },
      ],
    }
    respond({
      'events/get': () => manager(),
      'group-templates/catalog': () => ({
        items: [{ ...templates.items[0]!, name }],
      }),
      'group-templates/get': () => ({ ...detail, name }),
      'catalog/classes': () => CLASS_CATALOG,
      'roster/page': () => ({ items: [], nextCursor: null }),
      'group-templates/save': (body) => {
        const input = body as { id?: string; name: string }
        expect(input.id).toBe(templateId)
        name = input.name
        return { item: { ...detail, name } }
      },
    })
    await renderApp({ role: 'officer', path: `/events/${EVENT_ID}` })
    fireEvent.click(
      await screen.findByRole('button', { name: 'Шаблоны групп' }),
    )
    const library = within(await screen.findByRole('dialog'))
    fireEvent.click(await library.findByRole('button', { name: 'Изменить' }))
    await waitFor(() =>
      expect(callApi).toHaveBeenCalledWith('group-templates/get', {
        id: templateId,
      }),
    )
    await screen.findByLabelText('Название шаблона', {}, { timeout: 5_000 })
    const loadedEditor = within(
      screen.getByRole('dialog', { name: 'Редактировать шаблон групп' }),
    )
    expect(
      await loadedEditor.findByDisplayValue('Основа', {}, { timeout: 5_000 }),
    ).toBeVisible()
    expect(
      await loadedEditor.findByLabelText(
        'Название группы 1',
        {},
        { timeout: 5_000 },
      ),
    ).toHaveValue('Передовая')
    expect(
      loadedEditor.getByRole('list', { name: 'Участники группы Передовая' }),
    ).toHaveTextContent('Анна')

    fireEvent.change(loadedEditor.getByLabelText('Название шаблона'), {
      target: { value: 'Основа обновлённая' },
    })
    fireEvent.click(
      loadedEditor.getByRole('button', { name: 'Сохранить шаблон' }),
    )
    await waitFor(() =>
      expect(callApi).toHaveBeenCalledWith(
        'group-templates/save',
        expect.objectContaining({ id: templateId, name: 'Основа обновлённая' }),
      ),
    )
    expect(await screen.findByText('Основа обновлённая')).toBeVisible()

    fireEvent.click(await screen.findByRole('button', { name: 'Изменить' }))
    await screen.findByLabelText('Название шаблона', {}, { timeout: 5_000 })
    const loadedCancelled = within(
      screen.getByRole('dialog', { name: 'Редактировать шаблон групп' }),
    )
    await loadedCancelled.findByDisplayValue('Основа обновлённая')
    fireEvent.change(loadedCancelled.getByLabelText('Название шаблона'), {
      target: { value: 'Черновик, который отменят' },
    })
    fireEvent.click(loadedCancelled.getByRole('button', { name: 'Отмена' }))
    expect(await screen.findByText('Основа обновлённая')).toBeVisible()
    expect(screen.queryByText('Черновик, который отменят')).toBeNull()
  })

  it('shows five stats, filters one class with server search, and adds a participant', async () => {
    const page = vi.fn<(body: unknown) => unknown>((body: unknown) => {
      const request = body as { classId?: number; search?: string }
      if (request.search || request.classId) {
        return { items: [ANNA_ROSTER], nextCursor: null }
      }
      return { items: [ANNA_ROSTER], nextCursor: null }
    })
    respond({
      'events/get': () => manager(),
      'group-templates/catalog': () => ({ items: [] }),
      'catalog/classes': () => CLASS_CATALOG,
      'roster/page': page,
      'group-templates/save': () => ({ items: [] }),
    })
    await renderApp({ role: 'officer', path: `/events/${EVENT_ID}` })
    fireEvent.click(
      await screen.findByRole('button', { name: 'Шаблоны групп' }),
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Новый шаблон' }))

    const builder = within(await screen.findByRole('dialog'))
    const pool = await builder.findByRole('list', {
      name: 'Свободные участники',
    })
    const anna = within(pool).getByText('Анна').closest('li')!
    for (const value of ['125', '80', '—', '25']) {
      expect(within(anna).getByText(value)).toBeVisible()
    }
    expect(builder.getByText('ХП')).toBeVisible()
    expect(within(anna).getByText(/1\s000/)).toBeVisible()

    fireEvent.click(builder.getByRole('button', { name: 'Создать группу' }))
    const addAnna = builder.getByRole('button', {
      name: 'Действия: Анна',
    })
    fireEvent.keyDown(addAnna, { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Пати 1' }))
    const assigned = builder.getByRole('list', {
      name: 'Участники группы Пати 1',
    })
    expect(within(assigned).getByText('Анна')).toBeVisible()
    expect(within(assigned).queryByText(/1\s000/)).toBeNull()

    fireEvent.change(
      builder.getByRole('searchbox', { name: 'Поиск в составе' }),
      {
        target: { value: 'Анна' },
      },
    )
    const classFilter = builder.getByRole('combobox', {
      name: 'Фильтр по классу',
    })
    fireEvent.click(classFilter)
    fireEvent.click(await screen.findByRole('option', { name: 'Маг' }))
    await waitFor(
      () =>
        expect(page).toHaveBeenCalledWith(
          expect.objectContaining({ classId: 7, search: 'Анна', cursor: null }),
        ),
      { timeout: 2000 },
    )
  })

  it('loads the next participant page and prevents adding a 51st group member', async () => {
    const members = Array.from({ length: 50 }, (_, index) => ({
      userId: `66666666-6666-4666-8666-${String(index + 1).padStart(12, '0')}`,
      isLeader: false,
    }))
    const participants = members.map((member, index) =>
      person(member.userId, `Состав${index + 1}`),
    )
    const page = vi.fn<(body: unknown) => unknown>((body: unknown) => {
      const request = body as { cursor?: string | null }
      return request.cursor
        ? {
            items: [
              {
                ...ANNA_ROSTER,
                id: BORIS,
                gameNickname: 'Борис',
                classId: 8,
                className: 'Воин',
              },
            ],
            nextCursor: null,
          }
        : { items: [ANNA_ROSTER], nextCursor: 'следующая' }
    })
    respond({
      'events/get': () =>
        manager({
          participants: [...participants, person(ANNA, 'Анна')],
          groups: [group(members)],
        }),
      'group-templates/catalog': () => ({ items: [] }),
      'catalog/classes': () => CLASS_CATALOG,
      'roster/page': page,
    })
    await renderApp({ role: 'officer', path: `/events/${EVENT_ID}` })
    fireEvent.click(
      await screen.findByRole('button', { name: 'Шаблоны групп' }),
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Сохранить как шаблон' }),
    )
    const builder = within(await screen.findByRole('dialog'))
    expect(
      await builder.findByRole('list', { name: 'Свободные участники' }),
    ).toHaveTextContent('Анна')
    expect(await builder.findByText('Борис')).toBeVisible()
    await waitFor(() =>
      expect(page).toHaveBeenLastCalledWith({ cursor: 'следующая' }),
    )

    const add = builder.getByRole('button', { name: 'Действия: Анна' })
    fireEvent.keyDown(add, { key: 'Enter' })
    expect(
      await screen.findByRole('menuitem', { name: 'Пати 1 · максимум 50' }),
    ).toHaveAttribute('aria-disabled', 'true')
  })
})

describe('finalPosition (GRP-07)', () => {
  const groups = [
    group([
      { userId: 'a', isLeader: false },
      { userId: 'b', isLeader: false },
      { userId: 'c', isLeader: false },
    ]),
  ]

  it('accounts for removing the person before inserting', () => {
    // a — на место c: после снятия a строка c стоит на индексе 1.
    expect(finalPosition(groups, 'a', GROUP_ID, 2)).toBe(1)
    // c — на место a: индекс не меняется.
    expect(finalPosition(groups, 'c', GROUP_ID, 0)).toBe(0)
    // Человек из другой группы или пула — как есть.
    expect(finalPosition(groups, 'z', GROUP_ID, 1)).toBe(1)
  })
})
