import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ActivityHistoryResponse,
  ActivitySummaryResponse,
  RatingResponse,
} from '@contracts/activity'
import { AppError } from '@/lib/errors'
import type { Sheet } from '@/lib/xlsx'
import { renderApp } from './support/render-app'

const callApi = vi.hoisted(() =>
  vi.fn<(route: string, body?: unknown) => Promise<unknown>>(),
)
const toast = vi.hoisted(() => vi.fn<(message: string) => void>())
const downloadXlsx = vi.hoisted(() =>
  vi.fn<(fileName: string, sheets: Sheet[]) => void>(),
)

vi.mock('@/components/ui/toaster', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast,
}))
vi.mock('@/lib/supabase/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  callApi,
}))
vi.mock('@/lib/xlsx', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  downloadXlsx,
}))

function respond(routes: Record<string, (body: unknown) => unknown>) {
  callApi.mockImplementation((route, body) => {
    const handler = routes[route]
    if (!handler) {
      return Promise.reject(new AppError('not_found'))
    }
    return Promise.resolve(handler(body))
  })
}

const CLASSES = {
  classes: [
    { id: 7, slug: 'mage', name: 'Маг' },
    { id: 8, slug: 'warrior', name: 'Воин' },
  ],
}

const rating: RatingResponse = {
  eventCount: 3,
  truncated: false,
  items: [
    {
      userId: 'u1',
      gameNickname: 'Борис',
      classId: 8,
      className: 'Воин',
      visited: 3,
      missed: 0,
      unmarked: 0,
      percent: 100,
      leaderCount: 2,
      daysInGuild: 40,
    },
    {
      userId: 'u2',
      gameNickname: 'Анна',
      classId: 7,
      className: 'Маг',
      visited: 1,
      missed: 1,
      unmarked: 1,
      percent: 33,
      leaderCount: 0,
      daysInGuild: null,
    },
    {
      userId: 'u3',
      gameNickname: 'Вера',
      classId: 7,
      className: 'Маг',
      visited: 0,
      missed: 0,
      unmarked: 0,
      percent: null,
      leaderCount: 0,
      daysInGuild: 1,
    },
  ],
}

const summary: ActivitySummaryResponse = {
  eventCount: 2,
  truncated: false,
  items: [
    {
      userId: 'u1',
      gameNickname: 'Борис',
      classId: 8,
      className: 'Воин',
      isReader: false,
      visited: 2,
      missed: 0,
      unmarked: 0,
      percent: 100,
    },
    {
      userId: 'u2',
      gameNickname: 'Анна',
      classId: 7,
      className: 'Маг',
      isReader: true,
      visited: 0,
      missed: 1,
      unmarked: 1,
      percent: 0,
    },
  ],
}

function historyRow(eventTitle: string, gameNickname: string) {
  return {
    eventId: `e-${eventTitle}`,
    eventTitle,
    startsAt: '2026-11-14T17:00:00.000Z',
    dateMsk: '2026-11-14',
    userId: `u-${gameNickname}`,
    gameNickname,
    classId: 7,
    className: 'Маг',
    groupName: 'Пати 1',
    isLeader: false,
    status: 'visited' as const,
    isReader: false,
  }
}

/** Ники по строкам таблицы (ячейка «Участник», жирный текст). */
const rowNames = (table: HTMLElement) =>
  within(table)
    .getAllByRole('row')
    .slice(1)
    .map(
      (row) =>
        within(row).getAllByRole('cell')[1]!.querySelector('strong')
          ?.textContent,
    )

beforeEach(() => {
  callApi.mockReset()
  toast.mockReset()
  downloadXlsx.mockReset()
})

describe('attendance rating (ACT-14, ACT-15)', () => {
  it('shows the rating to a member with dashes, sorting and search', async () => {
    respond({ 'activity/rating': () => rating })
    await renderApp({ role: 'member', path: '/rating' })
    const table = await screen.findByRole('table', {
      name: 'Рейтинг посещения',
    })
    expect(rowNames(table)).toEqual(['Борис', 'Анна', 'Вера'])
    const vera = within(table).getAllByRole('row')[3]!
    expect(vera).toHaveTextContent('—')

    fireEvent.click(within(table).getByRole('button', { name: /Участник/ }))
    expect(rowNames(table)).toEqual(['Анна', 'Борис', 'Вера'])
    expect(
      within(table).getByRole('columnheader', { name: /Участник/ }),
    ).toHaveAttribute('aria-sort', 'ascending')

    fireEvent.change(screen.getByLabelText('Поиск по участнику'), {
      target: { value: 'маг' },
    })
    expect(rowNames(table)).toEqual(['Анна', 'Вера'])
  })

  it('is closed to readers and applicants', async () => {
    for (const role of ['reader', 'applicant'] as const) {
      const { unmount } = await renderApp({ role, path: '/rating' })
      expect(await screen.findByText('Нет доступа')).toBeVisible()
      unmount()
    }
    expect(callApi).not.toHaveBeenCalledWith(
      'activity/rating',
      expect.anything(),
    )
  })
})

describe('activity tracking (ACT-04–11, Q-25)', () => {
  it('is available only to officers and admins', async () => {
    const { unmount } = await renderApp({ role: 'member', path: '/activity' })
    expect(await screen.findByText('Нет доступа')).toBeVisible()
    unmount()
    expect(callApi).not.toHaveBeenCalledWith(
      'activity/summary',
      expect.anything(),
    )
  })

  it('applies period and class filters on the server and marks readers', async () => {
    respond({
      'catalog/classes': () => CLASSES,
      'activity/summary': () => summary,
    })
    await renderApp({
      role: 'officer',
      path: '/activity?from=2026-11-01&to=2026-11-30&classId=7',
    })
    const table = await screen.findByRole('table', {
      name: 'Сводка участников',
    })
    expect(callApi).toHaveBeenCalledWith('activity/summary', {
      from: '2026-11-01',
      to: '2026-11-30',
      classId: 7,
    })
    expect(within(table).getByText('Чтец')).toBeVisible()
    expect(
      screen.getByText('Участников: 2 · мероприятий в периоде: 2'),
    ).toBeVisible()
  })

  it('does not query a period that ends before it starts', async () => {
    respond({ 'catalog/classes': () => CLASSES })
    await renderApp({
      role: 'officer',
      path: '/activity?from=2026-11-30&to=2026-11-01',
    })
    expect(
      (await screen.findAllByText('Дата «по» раньше даты «с»')).length,
    ).toBeGreaterThan(0)
    expect(callApi).not.toHaveBeenCalledWith(
      'activity/summary',
      expect.anything(),
    )
    expect(
      screen.getByRole('button', { name: /Выгрузить Excel/ }),
    ).toBeDisabled()
  })

  it('exports both sheets with the active filters (ACT-11, Q-18)', async () => {
    const pages: Record<string, ActivityHistoryResponse> = {
      first: {
        items: [historyRow('Осада', 'Борис')],
        nextCursor: 'page-2',
      },
      second: {
        items: [historyRow('Рейд', 'Анна')],
        nextCursor: null,
      },
    }
    respond({
      'catalog/classes': () => CLASSES,
      'activity/summary': () => summary,
      'activity/history': (body) =>
        (body as { cursor: string | null }).cursor === 'page-2'
          ? pages.second
          : pages.first,
    })
    await renderApp({
      role: 'officer',
      path: '/activity?from=2026-11-01&classId=7&q=%D0%B1%D0%BE%D1%80',
    })
    await screen.findByRole('table', { name: 'Сводка участников' })
    fireEvent.click(screen.getByRole('button', { name: /Выгрузить Excel/ }))
    await waitFor(() => expect(downloadXlsx).toHaveBeenCalledTimes(1))

    const [fileName, sheets] = downloadXlsx.mock.calls[0]!
    expect(fileName).toMatch(/^MurrClan_activity_\d{4}-\d{2}-\d{2}\.xlsx$/)
    expect(sheets.map((sheet) => sheet.name)).toEqual([
      'Рейтинг',
      'История мероприятий',
    ])
    // Поиск «бор» — как на экране: в сводке остаётся только Борис.
    expect(sheets[0]!.rows).toEqual([
      [
        'Участник',
        'Класс',
        'Посетил',
        'Не посетил',
        'Не отметился',
        'Посещения (%)',
      ],
      ['Борис', 'Воин', 2, 0, 0, 100],
    ])
    expect(sheets[1]!.rows.slice(1)).toEqual([
      ['14.11.2026', 'Осада', 'Борис', 'Маг', 'Пати 1', 'Посетил'],
      ['14.11.2026', 'Рейд', 'Анна', 'Маг', 'Пати 1', 'Посетил'],
    ])
    expect(callApi).toHaveBeenCalledWith('activity/history', {
      from: '2026-11-01',
      to: null,
      classId: 7,
      search: 'бор',
      cursor: 'page-2',
      limit: 100,
    })
  })
})
