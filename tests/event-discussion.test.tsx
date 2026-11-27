import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ThreadRef } from '@contracts/discussions'
import { EventDiscussion } from '@/features/events/event-discussion'

vi.mock('@/features/discussions/discussion-thread', () => ({
  DiscussionThread: () => <div data-testid="inline-discussion-thread" />,
}))

const thread: ThreadRef = {
  parent: 'event',
  parentId: 'event-1',
}

function setWideScreen(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({
      matches,
      media: '(min-width: 64rem)',
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  })
}

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, 'matchMedia')
})

describe('event discussion placement (EVT-06, DSC-01)', () => {
  it('shows the thread inline on a wide screen', () => {
    setWideScreen(true)
    render(<EventDiscussion thread={thread} title="Рейд" messageCount={12} />)

    expect(
      screen.getByRole('heading', { name: 'Обсуждение ивента (12)' }),
    ).toBeVisible()
    expect(screen.getByTestId('inline-discussion-thread')).toBeVisible()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('keeps a button that opens the thread window on a phone', () => {
    setWideScreen(false)
    render(<EventDiscussion thread={thread} title="Рейд" messageCount={12} />)

    expect(
      screen.getByRole('button', { name: 'Обсуждение ивента (12)' }),
    ).toBeVisible()
    expect(screen.queryByTestId('inline-discussion-thread')).toBeNull()

    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('dialog')).toBeVisible()
    expect(screen.getByTestId('inline-discussion-thread')).toBeVisible()
  })
})
