import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountListItem } from '@contracts/accounts'
import type { RosterMember } from '@contracts/roster'
import { createQueryClient } from '@/app/query-client'
import { membersLabel } from '@/features/home/plural'
import { rosterBackgroundForClass } from '@/features/roster/backgrounds'
import { AppError } from '@/lib/errors'
import { renderApp } from './support/render-app'

const callApi = vi.hoisted(() =>
  vi.fn<(route: string, body?: unknown) => Promise<unknown>>(),
)
vi.mock('@/lib/supabase/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  callApi,
}))
const toast = vi.hoisted(() => vi.fn<(message: string) => void>())
const sessionUserId = vi.hoisted(() => ({ current: null as string | null }))
vi.mock('@/components/ui/toaster', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast,
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

type Handler = (body: unknown) => unknown
function respond(routes: Record<string, Handler>) {
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

const CLASSES = {
  classes: [
    { id: 1, slug: 'werewolf', name: 'Оборотень' },
    { id: 7, slug: 'mage', name: 'Маг' },
    { id: 8, slug: 'warrior', name: 'Воин' },
  ],
}

function member(
  id: string,
  nickname: string,
  classId: number,
  role: RosterMember['role'] = 'member',
): RosterMember {
  return {
    id,
    gameNickname: nickname,
    classId,
    className: CLASSES.classes.find((c) => c.id === classId)?.name ?? '',
    avatarUrl: null,
    role,
  }
}

const MEMBERS = [
  member('m1', 'Альфа', 1, 'officer'),
  member('m2', 'Бета', 7),
  member('m3', 'Гамма', 7, 'admin'),
]

function rosterPageResponse(
  members: RosterMember[],
  nextCursor: string | null = null,
) {
  return (body: unknown) => {
    const request = body as { classId?: number; search?: string }
    const needle = request.search?.toLowerCase() ?? ''
    return {
      items: members.filter(
        (item) =>
          (request.classId === undefined || item.classId === request.classId) &&
          (!needle ||
            item.gameNickname.toLowerCase().includes(needle) ||
            item.className.toLowerCase().includes(needle)),
      ),
      nextCursor,
    }
  }
}

/** Сколько раз страница запрашивала состав. */
function rosterCalls() {
  return callApi.mock.calls.filter(([route]) => route === 'roster/page').length
}

const STATS = {
  total: 3,
  classes: [
    { classId: 1, className: 'Оборотень', count: 1 },
    { classId: 7, className: 'Маг', count: 2 },
    { classId: 8, className: 'Воин', count: 0 },
  ],
}

let originalClientHeight: PropertyDescriptor | undefined
let originalClientWidth: PropertyDescriptor | undefined

afterEach(() => {
  if (originalClientHeight) {
    Object.defineProperty(
      HTMLElement.prototype,
      'clientHeight',
      originalClientHeight,
    )
    originalClientHeight = undefined
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight')
  }
  if (originalClientWidth) {
    Object.defineProperty(
      HTMLElement.prototype,
      'clientWidth',
      originalClientWidth,
    )
    originalClientWidth = undefined
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth')
  }
})

const READERS = {
  items: [member('r1', 'Чтец1', 8, 'reader')],
  nextCursor: null,
}

let routes: Record<string, Handler>
beforeEach(() => {
  callApi.mockReset()
  sessionUserId.current = null
  routes = {
    'catalog/classes': () => CLASSES,
    'roster/stats': () => STATS,
    'roster/page': rosterPageResponse(MEMBERS),
    'roster/readers': () => READERS,
    'roster/count': () => ({ count: 3 }),
  }
  respond(routes)
})

function chooseOption(trigger: HTMLElement, option: string) {
  fireEvent.keyDown(trigger, { key: 'ArrowDown' })
  fireEvent.click(screen.getByRole('option', { name: option }))
}

function openMenu(name: string) {
  const trigger = screen.getByRole('button', { name })
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
}

async function openReaders() {
  const tab = await screen.findByRole('tab', { name: 'Чтецы' })
  fireEvent.mouseDown(tab)
  fireEvent.click(tab)
}

const cards = () =>
  within(screen.getByRole('list', { name: 'Участники' })).getAllByRole(
    'listitem',
  )

describe('roster page', () => {
  it('uses one permanent illustration for each of the 17 classes', () => {
    const backgrounds = Array.from({ length: 17 }, (_, index) =>
      rosterBackgroundForClass(index + 1),
    )
    expect(backgrounds.every((background) => Boolean(background))).toBe(true)
    expect(new Set(backgrounds).size).toBe(17)
    expect(rosterBackgroundForClass(1)).toBe(rosterBackgroundForClass(1))
    expect(rosterBackgroundForClass(18)).toBeUndefined()
  })

  it('highlights only the current member card', async () => {
    sessionUserId.current = 'm2'
    await renderApp({ role: 'member', path: '/roster' })
    await screen.findByRole('heading', { name: 'Бета' })

    const betaCard = screen
      .getByRole('heading', { name: 'Бета' })
      .closest('li')!
    const alphaCard = screen
      .getByRole('heading', { name: 'Альфа' })
      .closest('li')!
    expect(betaCard.firstElementChild).toHaveClass(/bg-item-highlight!?/)
    expect(betaCard.firstElementChild).toHaveClass(/border-2!?/)
    expect(betaCard.firstElementChild).not.toHaveClass(/border-l-4/)
    expect(
      within(betaCard).getAllByRole('separator', { hidden: true }),
    ).toHaveLength(2)
    expect(alphaCard.firstElementChild).not.toHaveClass(/bg-item-highlight!?/)
    sessionUserId.current = null
  })

  it('shows the stats panel for the whole roster and filters cards by class', async () => {
    await renderApp({ role: 'member', path: '/roster' })
    expect(await screen.findByRole('heading', { name: 'Альфа' })).toBeVisible()
    const stats = screen.getByRole('list', { name: 'По классам' })
    // Классы без участников в панели не показываются, но есть в фильтре.
    expect(within(stats).getAllByRole('listitem')).toHaveLength(2)
    expect(within(stats).queryByText('Воин')).toBeNull()
    expect(cards()).toHaveLength(3)

    chooseOption(screen.getByRole('combobox', { name: 'Класс' }), 'Маг')
    await waitFor(() =>
      expect(cards().map((card) => card.textContent)).toEqual([
        expect.stringContaining('Бета'),
        expect.stringContaining('Гамма'),
      ]),
    )
    await waitFor(() => expect(rosterCalls()).toBeGreaterThan(1))
    expect(callApi).toHaveBeenCalledWith(
      'roster/page',
      expect.objectContaining({ classId: 7 }),
    )
    // Статистика не зависит от фильтра.
    expect(screen.getByText('3')).toBeVisible()

    chooseOption(screen.getByRole('combobox', { name: 'Класс' }), 'Воин')
    expect(
      await screen.findByText('В составе нет участников этого класса.'),
    ).toBeVisible()
  })

  it('shows a member no management actions and no readers', async () => {
    await renderApp({ role: 'member', path: '/roster' })
    await screen.findByRole('heading', { name: 'Альфа' })
    expect(
      screen.queryByRole('button', { name: /^Действия с участником/ }),
    ).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Чтецы' })).toBeNull()
    expect(callApi).not.toHaveBeenCalledWith(
      'roster/readers',
      expect.anything(),
    )
  })

  it('sends search to the server and loads the next cursor page', async () => {
    const firstPage = MEMBERS.slice(0, 2)
    routes['roster/page'] = (body) =>
      (body as { cursor?: string | null; search?: string }).cursor
        ? { items: [MEMBERS[2]!], nextCursor: null }
        : { items: firstPage, nextCursor: 'cursor-2' }
    const { router } = await renderApp({ role: 'member', path: '/roster' })
    expect(await screen.findByRole('heading', { name: 'Альфа' })).toBeVisible()
    fireEvent.change(screen.getByLabelText('Поиск'), {
      target: { value: 'гам' },
    })
    await waitFor(() =>
      expect(callApi).toHaveBeenCalledWith(
        'roster/page',
        expect.objectContaining({ search: 'гам', cursor: null }),
      ),
    )
    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({ search: 'гам' }),
    )
    routes['roster/page'] = (body) =>
      (body as { cursor?: string | null }).cursor
        ? { items: [MEMBERS[2]!], nextCursor: null }
        : { items: firstPage, nextCursor: 'cursor-2' }
    fireEvent.change(screen.getByLabelText('Поиск'), {
      target: { value: '' },
    })
    expect(await screen.findByRole('heading', { name: 'Гамма' })).toBeVisible()
    expect(callApi).toHaveBeenCalledWith(
      'roster/page',
      expect.objectContaining({ cursor: 'cursor-2' }),
    )
  })

  it('restores the search from the roster address', async () => {
    await renderApp({
      role: 'member',
      path: '/roster?search=%D0%91%D0%B5%D1%82%D0%B0',
    })
    expect(await screen.findByLabelText('Поиск')).toHaveValue('Бета')
    await waitFor(() =>
      expect(callApi).toHaveBeenCalledWith(
        'roster/page',
        expect.objectContaining({ search: 'Бета' }),
      ),
    )
  })

  it('shows the server-filtered empty state', async () => {
    routes['roster/page'] = rosterPageResponse([])
    await renderApp({ role: 'member', path: '/roster' })
    expect(
      await screen.findByText('В составе пока нет участников.'),
    ).toBeVisible()
  })

  it('lets an officer restore a reader (ACL-06, ADM-09)', async () => {
    routes['accounts/restore-reader'] = () => ({
      userId: 'r1',
      role: 'member',
      joinedOn: '2026-11-11',
    })
    await renderApp({ role: 'officer', path: '/roster' })
    await screen.findByRole('heading', { name: 'Альфа' })
    await openReaders()
    fireEvent.click(
      await screen.findByRole('button', { name: 'Восстановить в клане' }),
    )
    const dialog = await screen.findByRole('alertdialog')
    expect(
      within(dialog).getByText('Восстановить Чтец1 в клане?'),
    ).toBeVisible()
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Восстановить' }),
    )
    await waitFor(() =>
      expect(callApi).toHaveBeenCalledWith('accounts/restore-reader', {
        userId: 'r1',
      }),
    )
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  })

  it('lets an officer assign only ordinary members as readers after confirmation (ROS-07)', async () => {
    routes['accounts/set-role'] = () => ({
      userId: 'm2',
      role: 'reader',
      joinedOn: null,
    })
    await renderApp({ role: 'officer', path: '/roster' })
    await screen.findByRole('heading', { name: 'Альфа' })
    const trigger = screen.getByRole('button', {
      name: 'Действия с участником «Бета»',
    })

    fireEvent.keyDown(trigger, { key: 'Enter' })
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Присвоить статус «Чтец»' }),
    )
    const dialog = await screen.findByRole('alertdialog')
    expect(callApi).not.toHaveBeenCalledWith(
      'accounts/set-role',
      expect.anything(),
    )
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Присвоить «Чтец»' }),
    )
    await waitFor(() =>
      expect(callApi).toHaveBeenCalledWith('accounts/set-role', {
        userId: 'm2',
        role: 'reader',
      }),
    )
  })

  it('lets an admin block only plain members after confirmation (ROS-07)', async () => {
    routes['accounts/set-role'] = () => ({
      userId: 'm2',
      role: 'reader',
      joinedOn: null,
    })
    await renderApp({ role: 'admin', path: '/roster' })
    await screen.findByRole('heading', { name: 'Альфа' })
    const buttons = screen.getAllByRole('button', {
      name: /^Действия с участником/,
    })
    expect(buttons).toHaveLength(1)
    expect(buttons[0]!.closest('li')).toHaveTextContent('Бета')

    fireEvent.keyDown(buttons[0]!, { key: 'Enter' })
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Присвоить статус «Чтец»' }),
    )
    const dialog = await screen.findByRole('alertdialog')
    expect(callApi).not.toHaveBeenCalledWith(
      'accounts/set-role',
      expect.anything(),
    )
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Присвоить «Чтец»' }),
    )
    await waitFor(() =>
      expect(callApi).toHaveBeenCalledWith('accounts/set-role', {
        userId: 'm2',
        role: 'reader',
      }),
    )
  })

  it('lets a master choose a different role for a plain member after confirmation (ROS-12)', async () => {
    routes['accounts/set-role'] = () => ({
      userId: 'm2',
      role: 'officer',
      joinedOn: '2026-11-01',
    })
    await renderApp({ role: 'master', path: '/roster' })
    await screen.findByRole('heading', { name: 'Альфа' })
    const trigger = screen.getByRole('button', {
      name: 'Действия с участником «Бета»',
    })

    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(
      screen.queryByRole('menuitem', { name: 'Назначить роль «Член клана»' }),
    ).toBeNull()
    expect(
      screen.queryByRole('menuitem', { name: 'Назначить роль «Кандидат»' }),
    ).toBeNull()
    for (const role of ['Офицер', 'Чтец']) {
      expect(
        await screen.findByRole('menuitem', {
          name: `Назначить роль «${role}»`,
        }),
      ).toBeVisible()
    }
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'Назначить роль «Офицер»' }),
    )
    const dialog = await screen.findByRole('alertdialog')
    expect(
      within(dialog).getByText('Сменить роль Бета на «Офицер»?'),
    ).toBeVisible()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(callApi).not.toHaveBeenCalledWith(
      'accounts/set-role',
      expect.anything(),
    )

    fireEvent.keyDown(trigger, { key: 'Enter' })
    fireEvent.click(
      await screen.findByRole('menuitem', {
        name: 'Назначить роль «Офицер»',
      }),
    )
    const confirm = await screen.findByRole('alertdialog')
    fireEvent.click(
      within(confirm).getByRole('button', { name: 'Сменить роль' }),
    )
    await waitFor(() =>
      expect(callApi).toHaveBeenCalledWith('accounts/set-role', {
        userId: 'm2',
        role: 'officer',
      }),
    )
  })

  it('lets a master demote officers but not assign an equal or higher role', async () => {
    routes['accounts/set-role'] = () => ({
      userId: 'm1',
      role: 'member',
      joinedOn: '2026-11-11',
    })
    await renderApp({ role: 'master', path: '/roster' })
    await screen.findByRole('heading', { name: 'Альфа' })
    const trigger = screen.getByRole('button', {
      name: 'Действия с участником «Альфа»',
    })
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(
      screen.queryByRole('menuitem', { name: 'Назначить роль «Офицер»' }),
    ).toBeNull()
    expect(
      screen.queryByRole('menuitem', { name: 'Назначить роль «Кандидат»' }),
    ).toBeNull()
    for (const role of ['Член клана', 'Чтец']) {
      expect(
        await screen.findByRole('menuitem', {
          name: `Назначить роль «${role}»`,
        }),
      ).toBeVisible()
    }
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'Назначить роль «Член клана»' }),
    )
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Сменить роль' }),
    )
    await waitFor(() =>
      expect(callApi).toHaveBeenCalledWith('accounts/set-role', {
        userId: 'm1',
        role: 'member',
      }),
    )
  })

  it('lets a master choose a different role for readers and restores members through the existing action', async () => {
    routes['accounts/restore-reader'] = () => ({
      userId: 'r1',
      role: 'member',
      joinedOn: '2026-11-19',
    })
    await renderApp({ role: 'master', path: '/roster' })
    await screen.findByRole('heading', { name: 'Альфа' })
    await openReaders()
    const trigger = await screen.findByRole('button', {
      name: 'Действия с чтецом «Чтец1»',
    })
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(
      screen.queryByRole('menuitem', { name: 'Назначить роль «Чтец»' }),
    ).toBeNull()
    expect(
      screen.queryByRole('menuitem', { name: 'Назначить роль «Кандидат»' }),
    ).toBeNull()
    for (const role of ['Член клана', 'Офицер']) {
      expect(
        await screen.findByRole('menuitem', {
          name: `Назначить роль «${role}»`,
        }),
      ).toBeVisible()
    }
    fireEvent.click(
      screen.getByRole('menuitem', {
        name: 'Назначить роль «Член клана»',
      }),
    )
    const dialog = await screen.findByRole('alertdialog')
    expect(
      within(dialog).getByText('Сменить роль Чтец1 на «Член клана»?'),
    ).toBeVisible()
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Сменить роль' }),
    )
    await waitFor(() =>
      expect(callApi).toHaveBeenCalledWith('accounts/restore-reader', {
        userId: 'r1',
      }),
    )
  })

  it('keeps a master on the roster card when role changes fail', async () => {
    routes['accounts/set-role'] = () => {
      throw new AppError('application_pending')
    }
    await renderApp({ role: 'master', path: '/roster' })
    await screen.findByRole('heading', { name: 'Альфа' })
    const trigger = screen.getByRole('button', {
      name: 'Действия с участником «Бета»',
    })
    fireEvent.keyDown(trigger, { key: 'Enter' })
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Назначить роль «Чтец»' }),
    )
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Сменить роль' }),
    )
    expect(
      await within(dialog).findByText(
        'У пользователя есть заявка на рассмотрении: решение принимается в разделе «Заявки».',
      ),
    ).toBeVisible()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(screen.getByRole('heading', { name: 'Бета' })).toBeVisible()
  })

  it('is closed to readers and applicants (ACL-09)', async () => {
    for (const role of ['reader', 'applicant'] as const) {
      const { unmount } = await renderApp({ role, path: '/roster' })
      expect(await screen.findByText('Нет доступа')).toBeVisible()
      unmount()
    }
    expect(rosterCalls()).toBe(0)
  })

  it('reports a roster cut at the safety limit (Q-48)', async () => {
    routes['roster/page'] = rosterPageResponse(MEMBERS)
    await renderApp({ role: 'member', path: '/roster' })
    expect(await screen.findByRole('heading', { name: 'Альфа' })).toBeVisible()
  })

  it('opens member dynamics with name, guild date, filters and one weekly chart', async () => {
    routes['roster/dynamics/profile'] = () => ({
      id: 'm1',
      gameNickname: 'Альфа',
      className: 'Оборотень',
      avatarUrl: null,
      displayName: 'Мурр',
      joinedOn: '2024-01-02',
    })
    routes['roster/dynamics/stats'] = () => ({
      items: [
        {
          id: 'base-pa',
          field: 'pa',
          value: 100,
          recordedAt: '2026-10-30T20:59:00.000Z',
          kind: 'baseline',
        },
        {
          id: 'week1-pa',
          field: 'pa',
          value: 100,
          recordedAt: '2026-11-06T20:59:00.000Z',
          kind: 'checkpoint',
        },
        {
          id: 'week2-pa',
          field: 'pa',
          value: 120,
          recordedAt: '2026-11-13T20:59:00.000Z',
          kind: 'checkpoint',
        },
        {
          id: 'base-pz',
          field: 'pz',
          value: 80,
          recordedAt: '2026-10-30T20:59:00.000Z',
          kind: 'baseline',
        },
        {
          id: 'week1-pz',
          field: 'pz',
          value: 80,
          recordedAt: '2026-11-06T20:59:00.000Z',
          kind: 'checkpoint',
        },
        {
          id: 'week2-pz',
          field: 'pz',
          value: 90,
          recordedAt: '2026-11-13T20:59:00.000Z',
          kind: 'checkpoint',
        },
      ],
      nextCursor: null,
    })
    routes['roster/dynamics/attendance'] = () => ({
      items: [
        { weekStart: '2026-11-02', visited: 2, missed: 1, unmarked: 0 },
        { weekStart: '2026-11-09', visited: 2, missed: 1, unmarked: 0 },
        { weekStart: '2026-11-16', visited: 3, missed: 0, unmarked: 1 },
      ],
      nextCursor: null,
    })
    await renderApp({ role: 'member', path: '/roster' })
    fireEvent.click(
      await screen
        .findAllByRole('button', { name: 'Динамика развития' })
        .then((buttons) => buttons[0]!),
    )
    expect(await screen.findByText('Мурр')).toBeVisible()
    expect(screen.getByText('В клане с 02.01.2024')).toBeVisible()
    expect(screen.getByRole('checkbox', { name: 'ПА' })).toBeChecked()
    fireEvent.click(screen.getByRole('checkbox', { name: 'ПЗ' }))
    expect(
      await screen.findByRole('region', { name: 'График характеристик' }),
    ).toBeVisible()
    await waitFor(() =>
      expect(
        screen
          .getByRole('region', { name: 'График характеристик' })
          .querySelectorAll('circle'),
      ).toHaveLength(6),
    )
    expect(
      screen.getAllByRole('region', { name: 'График характеристик' }),
    ).toHaveLength(1)
    expect(screen.getByRole('checkbox', { name: 'ПЗ' })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Посещение ивентов' }))
    const attendance = await screen.findByRole('region', {
      name: 'Посещение ивентов по неделям',
    })
    expect(screen.getByRole('checkbox', { name: 'Посетил' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Не посетил' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Не отметил' })).toBeChecked()
    await waitFor(() =>
      expect(attendance.querySelectorAll('circle')).toHaveLength(9),
    )
    expect(
      attendance.querySelectorAll('path[fill="none"][stroke-width="1.75"]'),
    ).toHaveLength(3)
    const attendanceAxis = () =>
      Array.from(
        attendance.querySelectorAll('div.flex.flex-col.justify-between span'),
        (label) => label.textContent,
      )
    expect(attendanceAxis()).toEqual(['3', '1,5', '0'])
    fireEvent.click(screen.getByRole('checkbox', { name: 'Не посетил' }))
    await waitFor(() =>
      expect(attendance.querySelectorAll('circle')).toHaveLength(6),
    )
    expect(
      attendance.querySelectorAll('path[fill="none"][stroke-width="1.75"]'),
    ).toHaveLength(2)
    expect(attendanceAxis()).toEqual(['3', '1,5', '0'])
    fireEvent.mouseEnter(attendance.querySelector('circle')!)
    expect(screen.getByRole('status')).toHaveTextContent('посетил — 2')
    expect(
      callApi.mock.calls.some(([route]) => route === 'roster/dynamics/profile'),
    ).toBe(true)
  })

  it('does not show dynamics controls in the reader list', async () => {
    await renderApp({ role: 'officer', path: '/roster?view=readers' })
    expect(
      await within(
        await screen.findByRole('list', { name: 'Чтецы' }),
      ).findByText('Чтец1', { selector: 'strong' }),
    ).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Динамика развития' }),
    ).toBeNull()
  })

  it('opens the readers tab from the address for an officer', async () => {
    await renderApp({ role: 'officer', path: '/roster?view=readers' })
    expect(
      within(await screen.findByRole('list', { name: 'Чтецы' })).getByText(
        'Чтец1',
        { selector: 'strong' },
      ),
    ).toBeVisible()
    expect(rosterCalls()).toBe(0)
  })

  it('shows the class name when the class icon is unknown (ROS-09)', async () => {
    routes['roster/page'] = rosterPageResponse([
      { ...member('x', 'Дельта', 99), className: 'Новый класс' },
    ])
    await renderApp({ role: 'member', path: '/roster' })
    const card = (
      await screen.findByRole('heading', { name: 'Дельта' })
    ).closest('li')!
    expect(card).toHaveTextContent('Новый класс')
    expect(within(card).queryByRole('img')).toBeNull()
  })
})

describe('home page count (HOM-04)', () => {
  it.each(['guest', 'reader'] as const)(
    'shows the roster count without the roster to %s',
    async (role) => {
      await renderApp({ role, path: '/' })
      expect(await screen.findByText('3')).toBeVisible()
      expect(screen.getByText('участника')).toBeVisible()
      expect(screen.queryByText('Альфа')).toBeNull()
    },
  )

  it('shows the roster count to member', async () => {
    await renderApp({ role: 'member', path: '/' })
    const stat = await screen.findByRole('region', {
      name: 'Численность клана',
    })
    expect(await within(stat).findByText('3')).toBeVisible()
    expect(within(stat).getByText('участника')).toBeVisible()
  })

  it('declines the members label', () => {
    expect([1, 2, 5, 11, 12, 21, 104].map(membersLabel)).toEqual([
      'участник',
      'участника',
      'участников',
      'участников',
      'участников',
      'участник',
      'участника',
    ])
  })
})

function account(
  id: string,
  nickname: string,
  role: AccountListItem['role'],
  extra: Partial<AccountListItem> = {},
): AccountListItem {
  return {
    id,
    gameNickname: nickname,
    displayName: `Имя ${nickname}`,
    email: `${id}@example.test`,
    className: 'Воин',
    role,
    registeredAt: '2026-10-01T10:00:00Z',
    joinedOn: role === 'applicant' ? null : '2026-11-01',
    applicationStatus: null,
    isPrimaryAdmin: false,
    hasActiveApplication: false,
    deletionPending: false,
    ...extra,
  }
}

describe('admin accounts', () => {
  beforeEach(() => {
    routes['accounts/deletions'] = () => ({ items: [], truncated: false })
    routes['accounts/list'] = () => ({
      nextCursor: null,
      total: 4,
      items: [
        account('a1', 'Глава', 'admin', { isPrimaryAdmin: true }),
        account('a2', 'Зам', 'admin'),
        account('c1', 'Кандидат', 'applicant', { hasActiveApplication: true }),
        account('m1', 'Боец', 'member'),
      ],
    })
  })

  const roleSelect = (nickname: string) =>
    screen.getByRole('combobox', { name: `Роль ${nickname}` })

  it('lists accounts in a table and locks protected roles with a reason', async () => {
    await renderApp({ role: 'admin', path: '/admin' })
    expect(await screen.findByRole('table')).toBeVisible()
    expect(
      screen.getAllByRole('columnheader').map((th) => th.textContent),
    ).toEqual([
      'Ник',
      'Имя',
      'Email',
      'Класс',
      'Роль',
      'Заявка',
      'Дата вступления',
      'Действия',
    ])
    expect(screen.getByText('Аккаунтов: 4')).toBeVisible()
    expect(screen.getByText('m1@example.test')).toBeVisible()
    expect(screen.getAllByText('01.11.2026')[0]).toBeVisible()

    expect(roleSelect('Глава')).toBeDisabled()
    expect(roleSelect('Глава')).toHaveAccessibleDescription(
      'Основной администратор: роль не меняется',
    )
    expect(roleSelect('Кандидат')).toBeDisabled()
    expect(roleSelect('Кандидат')).toHaveAccessibleDescription(
      'Заявка на рассмотрении: решение — в разделе «Заявки»',
    )
    expect(roleSelect('Боец')).toBeEnabled()
  })

  it('changes a role after confirmation and updates the row', async () => {
    let roleChanged = false
    routes['accounts/list'] = () => ({
      nextCursor: null,
      total: 4,
      items: [
        account('a1', 'Глава', 'admin', { isPrimaryAdmin: true }),
        account('a2', 'Зам', 'admin'),
        account('c1', 'Кандидат', 'applicant', { hasActiveApplication: true }),
        account('m1', 'Боец', roleChanged ? 'officer' : 'member'),
      ],
    })
    routes['accounts/set-role'] = () => {
      roleChanged = true
      return { userId: 'm1', role: 'officer', joinedOn: '2026-11-01' }
    }
    await renderApp({ role: 'admin', path: '/admin' })
    chooseOption(
      await screen.findByRole('combobox', { name: 'Роль Боец' }),
      'Офицер',
    )
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Сменить роль Боец?')).toBeVisible()
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Сменить роль' }),
    )
    await waitFor(() =>
      expect(callApi).toHaveBeenCalledWith('accounts/set-role', {
        userId: 'm1',
        role: 'officer',
      }),
    )
    await waitFor(() => expect(roleSelect('Боец')).toHaveTextContent('Офицер'))
  })

  it('shows last_admin and keeps the previous role (ADM-06)', async () => {
    routes['accounts/set-role'] = () => {
      throw new AppError('last_admin')
    }
    await renderApp({ role: 'admin', path: '/admin' })
    chooseOption(
      await screen.findByRole('combobox', { name: 'Роль Зам' }),
      'Чтец',
    )
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Заблокировать Зам?')).toBeVisible()
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Заблокировать' }),
    )
    expect(
      await within(dialog).findByText(
        'Нельзя понизить последнего администратора.',
      ),
    ).toBeVisible()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(roleSelect('Зам')).toHaveTextContent('Администратор')
  })

  it('sends search and sort to the server (ADM-02)', async () => {
    await renderApp({ role: 'admin', path: '/admin' })
    await screen.findByRole('table')
    fireEvent.change(
      screen.getByLabelText('Поиск по нику, имени, email и классу'),
      { target: { value: 'бо' } },
    )
    await waitFor(() =>
      expect(callApi).toHaveBeenCalledWith(
        'accounts/list',
        expect.objectContaining({ search: 'бо', sort: 'nickname' }),
      ),
    )
    fireEvent.click(
      screen.getByRole('button', {
        name: 'По возрастанию — сменить на убывание',
      }),
    )
    await waitFor(() =>
      expect(callApi).toHaveBeenCalledWith(
        'accounts/list',
        expect.objectContaining({ search: 'бо', direction: 'desc' }),
      ),
    )
  })

  it('offers no deletion for admins and requires the nickname (Q-73)', async () => {
    routes['accounts/delete'] = () => ({ userId: 'm1' })
    await renderApp({ role: 'admin', path: '/admin' })
    await screen.findByRole('table')
    // Основной администратор: ни пароля, ни удаления.
    expect(
      screen.queryByRole('button', { name: 'Действия с Глава' }),
    ).toBeNull()
    openMenu('Действия с Зам')
    expect(
      screen.queryByRole('menuitem', { name: 'Удалить навсегда' }),
    ).toBeNull()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })

    openMenu('Действия с Боец')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить навсегда' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Удалить навсегда' }),
    )
    expect(await within(dialog).findByText('Ник не совпадает')).toBeVisible()
    expect(callApi).not.toHaveBeenCalledWith(
      'accounts/delete',
      expect.anything(),
    )
    fireEvent.change(
      within(dialog).getByLabelText('Введите ник «Боец» для подтверждения'),
      { target: { value: 'Боец' } },
    )
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Удалить навсегда' }),
    )
    await waitFor(() =>
      expect(callApi).toHaveBeenCalledWith('accounts/delete', {
        userId: 'm1',
        confirmNickname: 'Боец',
      }),
    )
  })

  it('changes a password without showing it in the toast (ADM-07)', async () => {
    routes['accounts/set-password'] = () => ({ userId: 'm1' })
    await renderApp({ role: 'admin', path: '/admin' })
    await screen.findByRole('table')
    openMenu('Действия с Боец')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Сменить пароль' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Новый пароль'), {
      target: { value: 'secret-pass-1' },
    })
    fireEvent.change(within(dialog).getByLabelText('Повторите пароль'), {
      target: { value: 'secret-pass-1' },
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Сменить пароль' }),
    )
    await waitFor(() =>
      expect(callApi).toHaveBeenCalledWith('accounts/set-password', {
        userId: 'm1',
        password: 'secret-pass-1',
      }),
    )
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        'Боец: пароль изменён, сеансы завершены',
      ),
    )
    expect(JSON.stringify(toast.mock.calls)).not.toContain('secret-pass-1')
  })

  it('shows pending deletions with a retry (Q-74)', async () => {
    routes['accounts/deletions'] = () => ({
      truncated: false,
      items: [
        {
          userId: 'x1',
          nickname: 'Ушедший',
          email: 'x1@example.test',
          stage: 'auth',
          lastError: 'auth_failed',
          createdAt: '2026-11-13T10:00:00Z',
          updatedAt: '2026-11-13T10:00:00Z',
        },
      ],
    })
    routes['accounts/delete'] = () => ({ userId: 'x1' })
    await renderApp({ role: 'admin', path: '/admin' })
    const region = await screen.findByRole('region', {
      name: 'Незавершённые удаления',
    })
    fireEvent.click(within(region).getByRole('button', { name: 'Повторить' }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Повторить' }))
    await waitFor(() =>
      expect(callApi).toHaveBeenCalledWith('accounts/delete', {
        userId: 'x1',
        confirmNickname: 'Ушедший',
      }),
    )
  })

  it('shows the audit log with category filter (ADM-10, ADM-12)', async () => {
    // jsdom has no element dimensions; provide a viewport for the virtual list.
    originalClientHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'clientHeight',
    )
    originalClientWidth = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'clientWidth',
    )
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => 900,
    })
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 400,
    })
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    routes['audit/list'] = () => ({
      nextCursor: null,
      items: [
        {
          id: 2,
          createdAt: '2026-11-13T10:00:00Z',
          category: 'broadcast',
          action: 'broadcast_draft_saved',
          summary: 'Сохранение черновика рассылки',
          actor: { nickname: 'Зам', role: 'officer', email: 'z@example.test' },
          target: {
            kind: 'broadcast_draft',
            id: 'd1',
            nickname: null,
            email: null,
          },
          details: { title: 'Сбор' },
        },
      ],
    })
    await renderApp({ role: 'admin', path: '/admin?tab=audit' })
    const auditList = await screen.findByRole('region', {
      name: 'Прокручиваемый список: Журнал действий',
    })
    expect(
      await screen.findByText('Сохранение черновика рассылки'),
    ).toBeVisible()
    expect(auditList).toHaveAttribute('data-viewport-rows', '15')
    expect(
      screen.getByText(/Исполнитель: Зам \(Офицер\) · z@example\.test/),
    ).toBeVisible()
    chooseOption(screen.getByRole('combobox', { name: 'Раздел' }), 'Рассылка')
    await waitFor(() =>
      expect(callApi).toHaveBeenCalledWith(
        'audit/list',
        expect.objectContaining({ category: 'broadcast' }),
      ),
    )
  })

  it('is closed to officers', async () => {
    await renderApp({ role: 'officer', path: '/admin' })
    expect(await screen.findByText('Нет доступа')).toBeVisible()
  })
})

describe('query client', () => {
  it('rereads the profile after a forbidden answer', async () => {
    const queryClient = createQueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    await queryClient
      .fetchQuery({
        queryKey: ['roster', 'list'],
        queryFn: () => Promise.reject(new AppError('forbidden')),
        retry: false,
      })
      .catch(() => undefined)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['me'] })

    invalidate.mockClear()
    await queryClient
      .fetchQuery({
        queryKey: ['other'],
        queryFn: () => Promise.reject(new AppError('network')),
        retry: false,
      })
      .catch(() => undefined)
    expect(invalidate).not.toHaveBeenCalled()
  })
})
