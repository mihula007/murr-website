import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RosterMember } from '@contracts/roster'
import {
  filterCharacterStats,
  formatCharacterStat,
  sortCharacterStats,
} from '@/features/roster/character-stats'
import { renderApp } from './support/render-app'

const callApi = vi.hoisted(() =>
  vi.fn<(route: string, body?: unknown) => Promise<unknown>>(),
)
const sessionUserId = vi.hoisted(() => ({ current: null as string | null }))
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

const members: RosterMember[] = [
  {
    id: 'a',
    gameNickname: 'Альфа',
    classId: 1,
    className: 'Оборотень',
    avatarUrl: null,
    role: 'member',
    pa: 12,
    pz: 9,
    bu: 1,
    hp: 12_500,
    bd: 9999,
  },
  {
    id: 'b',
    gameNickname: 'Бета',
    classId: 7,
    className: 'Маг',
    avatarUrl: null,
    role: 'officer',
    pa: 25,
    pz: 2,
    bu: null,
    hp: null,
    bd: 10_000,
  },
  {
    id: 'g',
    gameNickname: 'Гамма',
    classId: 7,
    className: 'Маг',
    avatarUrl: null,
    role: 'admin',
    pa: 25,
    pz: 15,
    bu: 3,
    hp: 20_500,
    bd: null,
  },
  {
    id: 'd',
    gameNickname: 'Дельта',
    classId: 8,
    className: 'Воин',
    avatarUrl: null,
    role: 'member',
    pa: null,
    pz: null,
    bu: null,
    hp: null,
    bd: null,
  },
]

beforeEach(() => {
  callApi.mockReset()
  sessionUserId.current = null
  callApi.mockImplementation((route) => {
    if (route === 'roster/page') {
      return Promise.resolve({
        items: structuredClone(members),
        nextCursor: null,
      })
    }
    if (route === 'roster/list') {
      return Promise.resolve({
        items: structuredClone(members),
        truncated: false,
      })
    }
    if (route === 'roster/stats') {
      return Promise.resolve({
        total: members.length,
        classes: [],
      })
    }
    if (route === 'roster/count') {
      return Promise.resolve({ count: members.length })
    }
    if (route === 'notifications/summary') {
      return Promise.resolve({ unreadCount: 0, sections: {} })
    }
    if (route === 'events/list') {
      return Promise.resolve({
        items: [],
        nextCursor: null,
        activeCount: 0,
        pastCount: 0,
        truncated: false,
      })
    }
    if (route === 'activity/month-top') {
      return Promise.resolve({ month: '2026-11', eventCount: 0, items: [] })
    }
    return new Promise(() => {})
  })
})

function chooseOption(trigger: HTMLElement, option: string) {
  fireEvent.keyDown(trigger, { key: 'ArrowDown' })
  fireEvent.click(screen.getByRole('option', { name: option }))
}

describe('форматирование и порядок характеристик', () => {
  it('shows a dash for empty values and formats numbers like the reference page', () => {
    expect(formatCharacterStat('pa', null)).toBe('—')
    expect(formatCharacterStat('pa', 125500)).toBe('125 500')
    expect(formatCharacterStat('pa', 12.35)).toBe('12,4')
    expect(formatCharacterStat('hp', 12_500)).toBe('12,5к')
    expect(formatCharacterStat('bd', 9999)).toBe('9 999')
  })

  it('sorts each stat in either direction, leaves blanks last, and ties by nickname', () => {
    expect(
      sortCharacterStats(members, 'pa', 'desc').map((item) => item.id),
    ).toEqual(['b', 'g', 'a', 'd'])
    expect(
      sortCharacterStats(members, 'pa', 'asc').map((item) => item.id),
    ).toEqual(['a', 'b', 'g', 'd'])
    expect(
      sortCharacterStats(members, 'pz', 'desc').map((item) => item.id),
    ).toEqual(['g', 'a', 'b', 'd'])
  })

  it('filters by class without changing the source roster', () => {
    expect(filterCharacterStats(members, 7).map((item) => item.id)).toEqual([
      'b',
      'g',
    ])
    expect(filterCharacterStats(members, null)).toHaveLength(4)
  })
})

describe('показатели состава и главная', () => {
  it('shows the class beside the nickname and five labeled stat cells without a class icon', async () => {
    const withPrivateSource = members.map((member) => ({
      ...member,
      characterStatsSource: 'секретный источник',
    }))
    callApi.mockImplementation((route) =>
      Promise.resolve(
        route === 'roster/page'
          ? { items: withPrivateSource, nextCursor: null }
          : route === 'roster/list'
            ? { items: withPrivateSource, truncated: false }
            : route === 'roster/stats'
              ? { total: withPrivateSource.length, classes: [] }
              : route === 'roster/count'
                ? { count: withPrivateSource.length }
                : { unreadCount: 0, sections: {} },
      ),
    )
    await renderApp({ role: 'member', path: '/roster' })
    const roster = await screen.findByRole('list', { name: 'Участники' })
    const alpha = within(roster)
      .getAllByRole('listitem')
      .find((item) => item.textContent?.includes('Альфа'))!
    const identity = within(alpha).getByRole('heading', {
      name: 'Альфа',
    }).parentElement
    expect(identity).toHaveTextContent('Оборотень')
    expect(identity?.querySelector('[aria-hidden="true"]')).toBeNull()
    const stats = within(alpha).getByLabelText('Характеристика Альфа')
    expect(stats).toHaveClass(/grid-cols-5/)
    expect(stats.children).toHaveLength(5)
    expect(within(stats).getByText('ПА')).toBeVisible()
    expect(within(alpha).getByText('12')).toBeVisible()
    expect(within(alpha).getByText('12,5к')).toBeVisible()
    expect(screen.queryByText('секретный источник')).toBeNull()
  })

  it('shows a sortable, filterable rating from the same roster response', async () => {
    await renderApp({ role: 'member', path: '/' })
    const rating = await screen.findByRole('region', { name: 'Рейтинг силы' })
    expect(rating).toHaveClass(/mt-12/)
    const table = within(rating).getByRole('table', { name: 'Рейтинг силы' })
    await waitFor(() =>
      expect(table.querySelectorAll('tbody tr')).toHaveLength(4),
    )
    expect(
      within(table).getByRole('columnheader', { name: 'Номер позиции' }),
    ).toBeVisible()
    const rows = Array.from(table.querySelectorAll('tbody tr'))
    expect(
      rows.map(
        (row) => row.querySelector('td > span:first-child')?.textContent,
      ),
    ).toEqual(['01', '02', '03', '04'])
    expect(
      rows.map((row) => row.querySelector('td > span:last-child')?.textContent),
    ).toEqual(['#1', '#2', '#3', '#4'])
    expect(rows[0]).toHaveClass('max-[900px]:before:from-medal-gold-from')
    expect(rows[2]).toHaveClass('max-[900px]:before:from-medal-bronze-from')
    expect(rows[3]?.className).not.toContain('before:')
    expect(rows[0]).toHaveClass('bg-surface-inset')
    expect(rows[1]).toHaveClass('bg-surface-from')
    expect(rows[0]?.querySelector('td')).toHaveClass('text-highlight')
    expect(rows[3]?.querySelector('td')).toHaveClass('text-muted-foreground')
    const scrollArea = within(rating).getByRole('region', {
      name: 'Прокручиваемый список рейтинга силы',
    })
    expect(scrollArea).toHaveClass(/overflow-y-auto/)
    const order = () =>
      Array.from(table.querySelectorAll('tbody tr')).map(
        (row) => row.textContent ?? '',
      )
    expect(order().findIndex((row) => row.includes('Бета'))).toBeLessThan(
      order().findIndex((row) => row.includes('Альфа')),
    )

    fireEvent.click(within(rating).getByRole('button', { name: 'ПЗ' }))
    expect(order().findIndex((row) => row.includes('Гамма'))).toBeLessThan(
      order().findIndex((row) => row.includes('Альфа')),
    )

    chooseOption(within(rating).getByRole('combobox', { name: 'Класс' }), 'Маг')
    await waitFor(() =>
      expect(table.querySelectorAll('tbody tr')).toHaveLength(2),
    )
    expect(order().join(' ')).toContain('Бета')
    expect(order().join(' ')).toContain('Гамма')
    expect(order().join(' ')).not.toContain('Альфа')
    expect(
      Array.from(table.querySelectorAll('tbody tr')).map(
        (row) => row.querySelector('td > span:first-child')?.textContent,
      ),
    ).toEqual(['01', '02'])
    expect(
      callApi.mock.calls.filter(([route]) => route === 'roster/list'),
    ).toHaveLength(1)
    expect(
      await screen.findByRole('region', {
        name: 'Топ-5 посещаемости за месяц',
      }),
    ).toBeVisible()
  })

  it('highlights the current user in the strength rating after sorting and filtering', async () => {
    sessionUserId.current = 'g'
    await renderApp({ role: 'member', path: '/' })
    const rating = await screen.findByRole('region', { name: 'Рейтинг силы' })
    const table = within(rating).getByRole('table', { name: 'Рейтинг силы' })
    const row = (nickname: string) =>
      within(table).getByText(nickname).closest('tr')!

    expect(row('Гамма')).toHaveClass(/bg-item-highlight!?/)
    expect(row('Бета')).not.toHaveClass(/bg-item-highlight!?/)

    fireEvent.click(within(rating).getByRole('button', { name: 'ПЗ' }))
    expect(row('Гамма')).toHaveClass(/bg-item-highlight!?/)
    expect(row('Бета')).not.toHaveClass(/bg-item-highlight!?/)

    chooseOption(within(rating).getByRole('combobox', { name: 'Класс' }), 'Маг')
    await waitFor(() => expect(row('Гамма')).toHaveClass(/bg-item-highlight!?/))
    expect(row('Бета')).not.toHaveClass(/bg-item-highlight!?/)
    sessionUserId.current = null
  })
})
