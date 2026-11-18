import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountListItem } from '@contracts/accounts'
import { renderApp } from './support/render-app'

const callApi = vi.hoisted(() =>
  vi.fn<(route: string, body?: unknown) => Promise<unknown>>(),
)
vi.mock('@/lib/supabase/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  callApi,
}))

const account: AccountListItem = {
  id: 'a1',
  gameNickname: 'Боец',
  displayName: 'Имя Боец',
  email: 'a1@example.test',
  className: 'Воин',
  role: 'member',
  registeredAt: '2026-10-01T10:00:00Z',
  joinedOn: '2026-11-01',
  applicationStatus: null,
  isPrimaryAdmin: false,
  hasActiveApplication: false,
  deletionPending: false,
}
let accountListRole = 'member'

beforeEach(() => {
  Object.defineProperty(window, 'scrollTo', {
    configurable: true,
    value: vi.fn<() => void>(),
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn<() => void>(),
  })
  callApi.mockReset()
  accountListRole = 'member'
  callApi.mockImplementation((route, body) => {
    if (route === 'accounts/list') {
      const query = body as { classId?: number | null; role?: string | null }
      if (query.classId === 2 && query.role === 'applicant') {
        return Promise.resolve({ items: [], total: 0, nextCursor: null })
      }
      if (query.role === 'member' && accountListRole !== 'member') {
        return Promise.resolve({ items: [], total: 0, nextCursor: null })
      }
      return Promise.resolve({ items: [account], total: 1, nextCursor: null })
    }
    if (route === 'accounts/set-role') {
      accountListRole = 'officer'
      return Promise.resolve({
        userId: account.id,
        role: 'officer',
        joinedOn: null,
      })
    }
    if (route === 'accounts/deletions') {
      return Promise.resolve({ items: [], truncated: false })
    }
    if (route === 'catalog/classes') {
      return Promise.resolve({
        classes: [
          { id: 1, slug: 'warrior', name: 'Воин' },
          { id: 2, slug: 'mage', name: 'Маг' },
        ],
      })
    }
    return new Promise(() => {})
  })
})

async function choose(label: string, option: string) {
  const select = await screen.findByRole('combobox', { name: label })
  fireEvent.keyDown(select, { key: 'ArrowDown' })
  fireEvent.click(await screen.findByRole('option', { name: option }))
}

describe('фильтры аккаунтов', () => {
  it('combines class and role, keeps them in the URL and sorts by registration', async () => {
    const { router } = await renderApp({ role: 'admin', path: '/admin' })
    await screen.findByRole('table')

    await choose('Фильтр по классу', 'Маг')
    await choose('Фильтр по роли', 'Администратор')

    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({
        classId: 2,
        role: 'admin',
      }),
    )
    await waitFor(() =>
      expect(callApi).toHaveBeenCalledWith(
        'accounts/list',
        expect.objectContaining({ classId: 2, role: 'admin' }),
      ),
    )

    await choose('Сортировка', 'Дата регистрации')
    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({
        classId: 2,
        role: 'admin',
        sort: 'registered',
      }),
    )
    await waitFor(() =>
      expect(callApi).toHaveBeenLastCalledWith(
        'accounts/list',
        expect.objectContaining({
          classId: 2,
          role: 'admin',
          sort: 'registered',
        }),
      ),
    )
  })

  it('offers a collapsible filters button on narrow screens', async () => {
    await renderApp({ role: 'admin', path: '/admin' })
    await screen.findByRole('table')

    const button = screen.getByRole('button', { name: 'Фильтры' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
  })

  it('restores filters and replaces an old sort with nickname', async () => {
    const { router } = await renderApp({
      role: 'admin',
      path: '/admin?classId=2&role=member&sort=email&dir=desc',
    })
    await screen.findByRole('table')

    expect(
      screen.getByRole('combobox', { name: 'Фильтр по классу' }),
    ).toHaveTextContent('Маг')
    expect(
      screen.getByRole('combobox', { name: 'Фильтр по роли' }),
    ).toHaveTextContent('Член клана')
    await waitFor(() =>
      expect(callApi).toHaveBeenCalledWith(
        'accounts/list',
        expect.objectContaining({
          classId: 2,
          role: 'member',
          sort: 'nickname',
          direction: 'desc',
        }),
      ),
    )
    expect(router.state.location.search).toMatchObject({
      classId: 2,
      role: 'member',
      sort: 'nickname',
      dir: 'desc',
    })
  })

  it('ignores class IDs outside the database range in a saved link', async () => {
    const { router } = await renderApp({
      role: 'admin',
      path: '/admin?classId=32768',
    })
    await screen.findByRole('table')

    expect(
      screen.getByRole('combobox', { name: 'Фильтр по классу' }),
    ).toHaveTextContent('Все классы')
    await waitFor(() =>
      expect(callApi).toHaveBeenCalledWith(
        'accounts/list',
        expect.objectContaining({ classId: null }),
      ),
    )
    expect(router.state.location.search.classId).toBeUndefined()
  })

  it('shows an empty state when active filters have no matches', async () => {
    await renderApp({ role: 'admin', path: '/admin' })
    await screen.findByRole('table')

    await choose('Фильтр по классу', 'Маг')
    await choose('Фильтр по роли', 'Кандидат')

    expect(await screen.findByText('Ничего не найдено')).toBeVisible()
  })

  it('clears each filter independently with its All option', async () => {
    const { router } = await renderApp({
      role: 'admin',
      path: '/admin?classId=2&role=member',
    })
    await screen.findByRole('table')

    await choose('Фильтр по классу', 'Все классы')
    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({ role: 'member' }),
    )
    expect(router.state.location.search.classId).toBeUndefined()
    await waitFor(() =>
      expect(callApi).toHaveBeenLastCalledWith(
        'accounts/list',
        expect.objectContaining({ classId: null, role: 'member' }),
      ),
    )

    await choose('Фильтр по роли', 'Все роли')
    await waitFor(() =>
      expect(router.state.location.search.classId).toBeUndefined(),
    )
    expect(router.state.location.search.role).toBeUndefined()
  })

  it('removes an account from the list after its role stops matching the filter', async () => {
    await renderApp({ role: 'admin', path: '/admin?role=member' })
    await screen.findByRole('table')
    await screen.findByRole('combobox', { name: 'Роль Боец' })

    await choose('Роль Боец', 'Офицер')
    await screen.findByRole('alertdialog')
    fireEvent.click(screen.getByRole('button', { name: 'Сменить роль' }))

    expect(await screen.findByText('Аккаунтов: 0')).toBeVisible()
    expect(await screen.findByText('Ничего не найдено')).toBeVisible()
  })
})
