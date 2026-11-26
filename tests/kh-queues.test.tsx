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
  return { id, userId, gameNickname, autoRejoin: false }
}

function renderBoard(
  role: 'member' | 'officer' | 'master' | 'admin' = 'member',
  queues = boardData(),
  limits = { maxActiveQueues: 14, activeQueueCount: 0 },
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
      {...limits}
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
      ).toHaveLength(2)
      expect(
        queueList.getByRole('button', {
          name: `Встать в очередь «${KH_QUEUE_LABELS[queueKey]}»`,
        }),
      ).toBeInTheDocument()
      for (const list of screen.getAllByRole('list', {
        name: `Очередь КХ: ${KH_QUEUE_LABELS[queueKey]}`,
      })) {
        expect(list).toHaveClass('[overflow-anchor:none]')
      }
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

  it('hides the personal join cell without numbering occupied positions', async () => {
    const queues = boardData({
      summons: {
        items: [entry('1', OTHER, 'Тест2'), entry('2', SELF, 'Тест1')],
        hasMore: false,
      },
    })
    renderBoard('member', queues)
    await userEvent.click(screen.getByRole('button', { name: 'призывы' }))
    const phoneSection = screen
      .getByRole('button', { name: 'призывы' })
      .closest('section')
    expect(phoneSection).not.toBeNull()
    const phoneList = within(phoneSection!).getByRole('list', {
      name: 'Очередь КХ: призывы',
    })
    expect(
      within(phoneList).queryByRole('button', {
        name: 'Встать в очередь «призывы»',
      }),
    ).not.toBeInTheDocument()
    expect(within(phoneList).queryByLabelText(/Место/)).not.toBeInTheDocument()
    expect(
      phoneList.querySelector('.lucide-user-round'),
    ).not.toBeInTheDocument()
  })

  it('opens one queue at a time in the phone view', async () => {
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

    await userEvent.click(screen.getByRole('button', { name: 'призывы' }))
    const summonsSection = screen
      .getByRole('button', { name: 'призывы' })
      .closest('section')
    expect(summonsSection).not.toBeNull()
    const summonsCard = within(summonsSection!)
    expect(
      within(
        summonsCard.getByRole('list', {
          name: 'Очередь КХ: призывы',
        }),
      ).getByText('Тест1'),
    ).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'пет' }))
    expect(
      summonsCard.queryByRole('list', { name: 'Очередь КХ: призывы' }),
    ).not.toBeInTheDocument()
    const petSection = screen
      .getByRole('button', { name: 'пет' })
      .closest('section')
    expect(petSection).not.toBeNull()
    expect(
      within(petSection!).getByRole('button', {
        name: 'Встать в очередь «пет»',
      }),
    ).toBeInTheDocument()
  })

  it('uses the fourteen numbered reward images in queue order', () => {
    const { container } = renderBoard()
    const images = Array.from(container.querySelectorAll('img'))
    for (let index = 1; index <= 14; index += 1) {
      expect(
        images.some(
          (image) => image.getAttribute('src') === `/kh-rewards/${index}.png`,
        ),
      ).toBe(true)
    }
  })

  it.each(['member', 'officer'] as const)(
    'centers the repeat checkbox with the nickname for a %s',
    async (role) => {
      const onRepeat =
        vi.fn<
          (queueKey: KhQueueId, entryId: string, autoRejoin: boolean) => void
        >()
      const queues = boardData({
        summons: { items: [entry('7', SELF, 'Тест1')], hasMore: false },
      })
      render(
        <KhQueueBoard
          queues={queues}
          accessRole={role}
          userId={SELF}
          maxActiveQueues={1}
          activeQueueCount={1}
          paging={{
            hasMore: false,
            loadingMore: false,
            loadError: false,
            onLoadMore: () => undefined,
          }}
          onJoin={() => undefined}
          onLeave={() => undefined}
          onIssue={() => undefined}
          onRepeat={onRepeat}
        />,
      )
      const checkbox = screen.getAllByRole('checkbox', {
        name: 'После выдачи снова встать в очередь',
      })[0]!
      const cell = checkbox.closest('[data-queue-entry]')
      expect(cell).toHaveClass('grid')
      const primary = cell?.querySelector<HTMLElement>('[data-entry-primary]')
      const nickname = cell?.querySelector<HTMLElement>('[data-entry-nickname]')
      const controls = cell?.querySelector('[data-entry-controls]')
      expect(cell?.children).toHaveLength(3)
      expect(cell?.children[1]).toBe(primary)
      expect(cell?.children[2]).toBe(controls)
      expect(primary).toHaveClass('justify-center')
      expect(
        primary?.querySelector('[data-entry-repeat]') ?? null,
      ).toContainElement(checkbox)
      expect(primary).toContainElement(nickname ?? null)
      await userEvent.click(checkbox)
      expect(onRepeat).toHaveBeenCalledWith('summons', '7', true)
      expect(
        screen.getByText('Занято ячеек: 1 из 1 · лимит достигнут'),
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Встать в очередь «пет»' }),
      ).not.toBeInTheDocument()
    },
  )

  it('lets the master remove another participant from the queue', async () => {
    const onRemove = vi.fn<(queueKey: KhQueueId, entryId: string) => void>()
    const queues = boardData({
      summons: { items: [entry('8', OTHER, 'Тест2')], hasMore: false },
    })
    render(
      <KhQueueBoard
        queues={queues}
        accessRole="master"
        onRemove={onRemove}
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
    const cell = screen
      .getByRole('button', { name: 'Удалить Тест2 из очереди «призывы»' })
      .closest('[data-queue-entry]')
    expect(cell).toHaveClass('grid-cols-[minmax(0,1fr)_auto]')
    expect(cell?.querySelector('[data-entry-nickname]')).toHaveClass(
      'text-left',
    )
    expect(cell?.querySelector('[data-entry-controls]')).toHaveClass(
      'justify-end',
    )
    await userEvent.click(
      screen.getAllByRole('button', {
        name: 'Удалить Тест2 из очереди «призывы»',
      })[0]!,
    )
    expect(onRemove).toHaveBeenCalledWith('summons', '8')
  })

  it('reserves hidden cells when the participant limit is full', () => {
    const queues = boardData({
      summons: {
        items: [entry('9', SELF, 'Тест1')],
        hasMore: false,
      },
    })
    renderBoard('member', queues, { maxActiveQueues: 1, activeQueueCount: 1 })

    const list = screen.getByRole('list', { name: 'Очередь КХ: пет' })
    expect(
      within(list).queryByRole('button', { name: 'Встать в очередь «пет»' }),
    ).not.toBeInTheDocument()
    expect(list.querySelector('[data-queue-reserved]')).toHaveClass('invisible')
  })

  it('keeps queue columns still when hovered', () => {
    const { container } = renderBoard()
    const column = container.querySelector(
      '[aria-labelledby="kh-column-summons"]',
    )
    expect(column).not.toHaveClass('hover:-translate-y-0.5')
  })
})
