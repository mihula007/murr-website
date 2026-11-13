import type { QueryClient } from '@tanstack/react-query'
import {
  ACTIVITY_EXPORT_LIMIT,
  type ActivityHistoryResponse,
  type ActivitySummaryResponse,
  type ActivitySummaryRow,
} from '@contracts/activity'
import { ATTENDANCE_STATUS_LABELS } from '@contracts/groups'
import { callApi } from '@/lib/supabase/api'
import { formatDate } from '@/lib/format-date'
import type { ActivityFilters } from './api'
import { activityKeys } from './query-keys'

/** Поиск сводки на клиенте — тот же, что на экране (Q-48). */
export function matchesSearch(row: ActivitySummaryRow, search: string | null) {
  const query = (search ?? '').trim().toLocaleLowerCase('ru-RU')
  return (
    !query ||
    `${row.gameNickname} ${row.className}`
      .toLocaleLowerCase('ru-RU')
      .includes(query)
  )
}

/**
 * Книга учёта с фильтрами на момент выгрузки (ACT-09, ACT-11, Q-18): лист
 * «Рейтинг» — сводка участников, лист «История мероприятий» — все строки
 * истории, догруженные по курсору. Данные — из тех же операций, что экран.
 */
export async function exportActivityWorkbook(
  queryClient: QueryClient,
  filters: ActivityFilters,
  search: string | null,
) {
  const summary = await queryClient.fetchQuery({
    queryKey: activityKeys.summary(filters),
    queryFn: () =>
      callApi<ActivitySummaryResponse>('activity/summary', filters),
  })
  const history: ActivityHistoryResponse['items'] = []
  let cursor: string | null = null
  do {
    const page: ActivityHistoryResponse = await queryClient.fetchQuery({
      queryKey: [
        ...activityKeys.history({ ...filters, search }),
        'export',
        cursor,
      ],
      queryFn: () =>
        callApi<ActivityHistoryResponse>('activity/history', {
          ...filters,
          search,
          cursor,
          limit: 100,
        }),
      staleTime: 0,
      gcTime: 0,
    })
    history.push(...page.items)
    cursor = page.nextCursor
  } while (cursor && history.length < ACTIVITY_EXPORT_LIMIT)

  const { downloadXlsx } = await import('@/lib/xlsx')
  downloadXlsx(
    `MurrClan_activity_${new Date().toISOString().slice(0, 10)}.xlsx`,
    [
      {
        name: 'Рейтинг',
        rows: [
          [
            'Участник',
            'Класс',
            'Посетил',
            'Не посетил',
            'Не отметился',
            'Посещения (%)',
          ],
          ...summary.items
            .filter((row) => matchesSearch(row, search))
            .map((row) => [
              row.isReader ? `${row.gameNickname} (чтец)` : row.gameNickname,
              row.className,
              row.visited,
              row.missed,
              row.unmarked,
              row.percent,
            ]),
        ],
      },
      {
        name: 'История ивентов',
        rows: [
          ['Дата', 'Ивент', 'Участник', 'Класс', 'Группа', 'Посещение'],
          ...history.map((row) => [
            formatDate(row.dateMsk),
            row.eventTitle,
            row.gameNickname,
            row.className,
            row.groupName ?? '—',
            ATTENDANCE_STATUS_LABELS[row.status],
          ]),
        ],
      },
    ],
  )
  return {
    summary: summary.items.length,
    history: history.length,
    truncated: cursor !== null,
  }
}
