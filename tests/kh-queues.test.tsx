import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { KH_QUEUE_IDS, KH_QUEUE_LABELS } from '@contracts/kh'
import type { KhQueueEntry, KhQueueId } from '@contracts/kh'
import {
  KhQueueBoard,
  type KhQueueBoardData,
} from '@/features/kh-queues/kh-queue-board'

const SELF = '00000000-0000-4000-8000-000000000001'
const OTHER = '00000000-0000-4000-8000-000000000002'

function boardData(
  overrides: Partial<KhQueueBoardData> = {},
): KhQueueBoardData {
  return {
    ...Object.fromEntries(
      KH_QUEUE_IDS.map((queueKey) => [queueKey, { items: [], hasMore: false }]),
    ),
    ...overrides,
  } as KhQueueBoardData
}

function entry(id: string, userId: string, gameNickname: string): KhQueueEntry {
  return { id, userId, gameNickname }
}

function renderBoard(
  role: 'member' | 'officer' | 'master' | 'admin' = 'member',
  queues = boardData(),
) {
  return render(
    <KhQueueBoard
      queues={queues}
      accessRole={role}
      userId={SELF}
      paging={{
        hasMore: false,
        loadingMore: false,
        loadError: false,
        onLoadMore: () => undefined,
      }}
      onJoin={() => undefined}
      onLeave={() => undefined}
      onIssue={() => undefined}
    />,
  )
}

describe('KhQueueBoard', () => {
  it('shows all fourteen approved queue titles and a free cell for each empty queue', () => {
    renderBoard()

    for (const queueKey of KH_QUEUE_IDS) {
      const queueList = within(
        screen.getByRole('list', {
          name: `Очередь КХ: ${KH_QUEUE_LABELS[queueKey]}`,
        }),
      )
      expect(
        screen.getAllByRole('heading', { name: KH_QUEUE_LABELS[queueKey] }),
      ).toHaveLength(queueKey === 'summons' ? 2 : 1)
      expect(
        queueList.getByRole('button', {
          name: `Встать в очередь «${KH_QUEUE_LABELS[queueKey]}»`,
        }),
      ).toBeInTheDocument()
    }
  })

  it('lets a participant remove only their own active row', async () => {
    const onLeave = vi.fn<(queueKey: KhQueueId, entryId: string) => void>()
    const queues = boardData({
      summons: {
        items: [entry('1', SELF, 'Тест1'), entry('2', OTHER, 'Тест2')],
        hasMore: false,
      },
    })
    render(
      <KhQueueBoard
        queues={queues}
        accessRole="member"
        userId={SELF}
        paging={{
          hasMore: false,
          loadingMore: false,
          loadError: false,
          onLoadMore: () => undefined,
        }}
        onJoin={() => undefined}
        onLeave={onLeave}
        onIssue={() => undefined}
      />,
    )

    await userEvent.click(
      screen.getAllByRole('button', {
        name: 'Убрать Тест1 из очереди «призывы»',
      })[0]!,
    )
    expect(onLeave).toHaveBeenCalledWith('summons', '1')
    expect(
      screen.queryByRole('button', {
        name: 'Убрать Тест2 из очереди «призывы»',
      }),
    ).not.toBeInTheDocument()
  })

  it('places a participant at the end by selecting the free cell', async () => {
    const onJoin = vi.fn<(queueKey: KhQueueId) => void>()
    render(
      <KhQueueBoard
        queues={boardData()}
        accessRole="member"
        userId={SELF}
        paging={{
          hasMore: false,
          loadingMore: false,
          loadError: false,
          onLoadMore: () => undefined,
        }}
        onJoin={onJoin}
        onLeave={() => undefined}
        onIssue={() => undefined}
      />,
    )

    await userEvent.click(
      screen.getByRole('button', {
        name: 'Встать в очередь «пет»',
      }),
    )
    expect(onJoin).toHaveBeenCalledWith('pet')
  })

  it('shows issue checks only to the master and removes the checked entry', async () => {
    const onIssue = vi.fn<(queueKey: KhQueueId, entryId: string) => void>()
    const queues = boardData({
      summons: {
        items: [entry('9', OTHER, 'Тест2')],
        hasMore: false,
      },
    })
    render(
      <KhQueueBoard
        queues={queues}
        accessRole="master"
        userId={OTHER}
        paging={{
          hasMore: false,
          loadingMore: false,
          loadError: false,
          onLoadMore: () => undefined,
        }}
        onJoin={() => undefined}
        onLeave={() => undefined}
        onIssue={onIssue}
      />,
    )

    await userEvent.click(
      screen.getAllByRole('button', {
        name: 'Отметить выдачу: Тест2 в очереди «призывы»',
      })[0]!,
    )
    expect(onIssue).toHaveBeenCalledWith('summons', '9')
    expect(
      screen.queryByRole('button', {
        name: 'Встать в очередь «призывы»',
      }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Свободно')).not.toBeInTheDocument()
  })

  it('hides the personal join cell after joining and numbers queue positions', () => {
    const queues = boardData({
      summons: {
        items: [entry('1', OTHER, 'Тест2'), entry('2', SELF, 'Тест1')],
        hasMore: false,
      },
    })
    renderBoard('member', queues)
    const phoneList = within(
      screen.getByRole('list', { name: 'Очередь КХ на телефоне' }),
    )
    expect(
      phoneList.queryByRole('button', {
        name: 'Встать в очередь «призывы»',
      }),
    ).not.toBeInTheDocument()
    expect(phoneList.getByLabelText('Место 1')).toHaveTextContent('1')
    expect(phoneList.getByLabelText('Место 2')).toHaveTextContent('2')
  })

  it('shows one selected queue in the phone view without hiding other queues from the selector', async () => {
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      configurable: true,
      value: () => false,
    })
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: () => undefined,
    })
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
      configurable: true,
      value: () => undefined,
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: () => undefined,
    })
    const queues = boardData({
      summons: {
        items: [entry('1', SELF, 'Тест1')],
        hasMore: false,
      },
    })
    renderBoard('member', queues)

    const phoneList = screen.getByRole('list', {
      name: 'Очередь КХ на телефоне',
    })
    expect(within(phoneList).getByText('Тест1')).toBeInTheDocument()

    await userEvent.click(
      screen.getByRole('combobox', { name: 'Выбрать очередь КХ' }),
    )
    await userEvent.click(screen.getByRole('option', { name: 'пет' }))

    expect(
      within(
        screen.getByRole('list', { name: 'Очередь КХ на телефоне' }),
      ).queryByText('Тест1'),
    ).not.toBeInTheDocument()
    expect(
      within(
        screen.getByRole('list', { name: 'Очередь КХ на телефоне' }),
      ).getByRole('button', { name: 'Встать в очередь «пет»' }),
    ).toBeInTheDocument()
  })
})
