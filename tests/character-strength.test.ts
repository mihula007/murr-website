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
vi.mock('@/lib/supabase/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  callApi,
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
  callApi.mockImplementation((route) => {
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
  it('shows five values beneath each member nickname and never shows the source', async () => {
    const withPrivateSource = members.map((member) => ({
      ...member,
      characterStatsSource: 'секретный источник',
    }))
    callApi.mockImplementation((route) =>
      Promise.resolve(
        route === 'roster/list'
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
    expect(within(alpha).getByText('ПА')).toBeVisible()
    expect(within(alpha).getByText('12')).toBeVisible()
    expect(within(alpha).getByText('12,5к')).toBeVisible()
    expect(screen.queryByText('секретный источник')).toBeNull()
  })

  it('shows a sortable, filterable rating from the same roster response', async () => {
    await renderApp({ role: 'member', path: '/' })
    const rating = await screen.findByRole('region', { name: 'Рейтинг силы' })
    const table = within(rating).getByRole('table', { name: 'Рейтинг силы' })
    await waitFor(() =>
      expect(table.querySelectorAll('tbody tr')).toHaveLength(4),
    )
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
      callApi.mock.calls.filter(([route]) => route === 'roster/list'),
    ).toHaveLength(1)
    expect(
      await screen.findByRole('region', {
        name: 'Топ-5 посещаемости за месяц',
      }),
    ).toBeVisible()
  })
})
