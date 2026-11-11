import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountListItem } from '@contracts/accounts'
import type { RosterMember } from '@contracts/roster'
import { createQueryClient } from '@/app/query-client'
import { membersLabel } from '@/features/home/home-page'
import { AppError } from '@/lib/errors'
import { renderApp } from './support/render-app'

const callApi = vi.hoisted(() =>
  vi.fn<(route: string, body?: unknown) => Promise<unknown>>(),
)
vi.mock('@/lib/supabase/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  callApi,
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

/** Сервер фильтрует по классу; без курсора — первая и единственная страница. */
function rosterPage(members: RosterMember[]) {
  return (body: unknown) => {
    const { classId } = body as { classId: number | null }
    return {
      items: members.filter((m) => classId === null || m.classId === classId),
      nextCursor: null,
    }
  }
}

const STATS = {
  total: 3,
  classes: [
    { classId: 1, className: 'Оборотень', count: 1 },
    { classId: 7, className: 'Маг', count: 2 },
    { classId: 8, className: 'Воин', count: 0 },
  ],
}

const READERS = {
  items: [member('r1', 'Чтец1', 8, 'reader')],
  nextCursor: null,
}

let routes: Record<string, Handler>
beforeEach(() => {
  callApi.mockReset()
  routes = {
    'catalog/classes': () => CLASSES,
    'roster/stats': () => STATS,
    'roster/list': rosterPage(MEMBERS),
    'roster/readers': () => READERS,
    'roster/count': () => ({ count: 3 }),
  }
  respond(routes)
})

function chooseOption(trigger: HTMLElement, option: string) {
  fireEvent.keyDown(trigger, { key: 'ArrowDown' })
  fireEvent.click(screen.getByRole('option', { name: option }))
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
    expect(callApi).toHaveBeenCalledWith('roster/list', {
      classId: 7,
      cursor: null,
    })
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
      screen.queryByRole('button', { name: /Присвоить статус/ }),
    ).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Чтецы' })).toBeNull()
    expect(callApi).not.toHaveBeenCalledWith(
      'roster/readers',
      expect.anything(),
    )
  })

  it('lets an officer restore a reader but not block (ACL-03, ADM-09)', async () => {
    routes['accounts/restore-reader'] = () => ({
      userId: 'r1',
      role: 'member',
      joinedOn: '2026-11-11',
    })
    await renderApp({ role: 'officer', path: '/roster' })
    await screen.findByRole('heading', { name: 'Альфа' })
    expect(
      screen.queryByRole('button', { name: /Присвоить статус/ }),
    ).toBeNull()

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

  it('lets an admin block only plain members after confirmation (ROS-07)', async () => {
    routes['accounts/set-role'] = () => ({
      userId: 'm2',
      role: 'reader',
      joinedOn: null,
    })
    await renderApp({ role: 'admin', path: '/roster' })
    await screen.findByRole('heading', { name: 'Альфа' })
    const buttons = screen.getAllByRole('button', { name: /Присвоить статус/ })
    expect(buttons).toHaveLength(1)
    expect(buttons[0]!.closest('li')).toHaveTextContent('Бета')

    fireEvent.click(buttons[0]!)
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

  it('is closed to readers and applicants (ACL-09)', async () => {
    for (const role of ['reader', 'applicant'] as const) {
      const { unmount } = await renderApp({ role, path: '/roster' })
      expect(await screen.findByText('Нет доступа')).toBeVisible()
      unmount()
    }
    expect(callApi).not.toHaveBeenCalledWith('roster/list', expect.anything())
  })

  it('loads the next roster page with the cursor', async () => {
    routes['roster/list'] = (body) =>
      (body as { cursor: string | null }).cursor === 'page-2'
        ? { items: [member('m9', 'Омега', 8)], nextCursor: null }
        : { items: MEMBERS, nextCursor: 'page-2' }
    await renderApp({ role: 'member', path: '/roster' })
    expect(await screen.findByRole('heading', { name: 'Омега' })).toBeVisible()
    expect(cards()).toHaveLength(4)
    expect(callApi).toHaveBeenCalledWith('roster/list', {
      classId: null,
      cursor: 'page-2',
    })
  })

  it('opens the readers tab from the address for an officer', async () => {
    await renderApp({ role: 'officer', path: '/roster?view=readers' })
    expect(
      within(await screen.findByRole('list', { name: 'Чтецы' })).getByText(
        'Чтец1',
        { selector: 'strong' },
      ),
    ).toBeVisible()
    expect(callApi).not.toHaveBeenCalledWith('roster/list', expect.anything())
  })

  it('shows the class name when the class icon is unknown (ROS-09)', async () => {
    routes['roster/list'] = rosterPage([
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
  it.each(['guest', 'reader', 'member'] as const)(
    'shows the roster count to %s',
    async (role) => {
      await renderApp({ role, path: '/' })
      expect(await screen.findByText('3')).toBeVisible()
      expect(screen.getByText('участника')).toBeVisible()
      expect(screen.queryByText('Альфа')).toBeNull()
    },
  )

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
    role,
    joinedOn: role === 'applicant' ? null : '2026-11-01',
    isPrimaryAdmin: false,
    hasActiveApplication: false,
    ...extra,
  }
}

describe('admin accounts', () => {
  beforeEach(() => {
    routes['accounts/list'] = () => ({
      nextCursor: null,
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
    ).toEqual(['Ник', 'Имя', 'Email', 'Роль', 'Дата вступления'])
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
    routes['accounts/set-role'] = () => ({
      userId: 'm1',
      role: 'officer',
      joinedOn: '2026-11-01',
    })
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
