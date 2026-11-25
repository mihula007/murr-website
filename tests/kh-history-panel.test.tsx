import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { KH_QUEUE_IDS } from '@contracts/kh'
import type { KhRewardHistoryRow } from '@contracts/kh'
import { KhHistoryPanel } from '@/features/kh-queues/kh-history-panel'
import { useKhRewardHistory } from '@/features/kh-queues/api'

vi.mock('@/features/kh-queues/api', () => ({
  useKhRewardHistory: vi.fn<(dateFrom: string, dateTo: string) => unknown>(),
}))
vi.mock('@/components/virtual-list', () => ({
  ScrollableVirtualList: ({
    items,
    getKey,
    renderItem,
    label,
    viewportRows,
  }: {
    items: KhRewardHistoryRow[]
    getKey: (item: KhRewardHistoryRow) => string
    renderItem: (item: KhRewardHistoryRow) => React.ReactNode
    label: string
    viewportRows: number
  }) => (
    <section
      aria-label={`Прокручиваемый список: ${label}`}
      data-viewport-rows={viewportRows}
    >
      <ul aria-label={label}>
        {items.map((item) => (
          <li key={getKey(item)}>{renderItem(item)}</li>
        ))}
      </ul>
    </section>
  ),
}))

const mockHistory = vi.mocked(useKhRewardHistory)

function result(
  items: Array<{
    id: string
    queueKey: (typeof KH_QUEUE_IDS)[number]
    rewardName: string
    userId: string | null
    gameNickname: string
    issuedAt: string
  }>,
) {
  return {
    data: { items, hasNextPage: false },
    hasNextPage: false,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    fetchNextPage: vi.fn<() => Promise<unknown>>().mockResolvedValue(undefined),
    isPending: false,
    isError: false,
    refetch: vi.fn<() => Promise<unknown>>().mockResolvedValue(undefined),
  } as unknown as ReturnType<typeof useKhRewardHistory>
}

afterEach(() => {
  vi.useRealTimers()
  mockHistory.mockReset()
})

describe('KhHistoryPanel', () => {
  it('starts with a 30-day period and allows both date bounds to be changed', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-26T12:00:00.000Z'))
    mockHistory.mockReturnValue(result([]))
    render(<KhHistoryPanel />)
    expect(screen.getByLabelText('С даты')).toHaveValue('2026-10-27')
    expect(screen.getByLabelText('По дату')).toHaveValue('2026-11-26')
  })

  it('shows reward name, nickname and Moscow issue time in the internal list', async () => {
    mockHistory.mockReturnValue(
      result([
        {
          id: '1',
          queueKey: 'summons',
          rewardName: 'призывы',
          userId: null,
          gameNickname: 'БезАккаунта',
          issuedAt: '2026-11-26T12:00:00.000Z',
        },
      ]),
    )
    render(<KhHistoryPanel />)
    expect(
      screen.getByLabelText('Прокручиваемый список: История выдачи наград КХ'),
    ).toBeInTheDocument()
    expect(
      screen.getByLabelText('Прокручиваемый список: История выдачи наград КХ'),
    ).toHaveAttribute('data-viewport-rows', '20')
    expect(screen.getByText('БезАккаунта')).toBeInTheDocument()
    expect(screen.getByText(/выдана награда/)).toBeInTheDocument()
    expect(screen.getByText('26.11.2026, 15:00 МСК')).toBeInTheDocument()
  })
})
