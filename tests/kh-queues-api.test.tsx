import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { KH_QUEUE_IDS, type KhQueuesResponse } from '@contracts/kh'
import {
  useJoinKhQueue,
  useLeaveKhQueue,
  useSetKhQueueRepeat,
} from '@/features/kh-queues/api'

const mocks = vi.hoisted(() => ({
  callApi: vi.fn<(route: string, body: unknown) => Promise<unknown>>(),
}))

vi.mock('@/lib/supabase/api', () => ({ callApi: mocks.callApi }))

const settingsKey = ['kh', 'settings']

function Actions() {
  const join = useJoinKhQueue()
  const leave = useLeaveKhQueue()
  return (
    <>
      <button
        type="button"
        onClick={() => join.mutate({ queueKey: 'summons' })}
      >
        Встать
      </button>
      <button
        type="button"
        onClick={() => leave.mutate({ queueKey: 'summons', entryId: '1' })}
      >
        Уйти
      </button>
    </>
  )
}

function RepeatAction() {
  const repeat = useSetKhQueueRepeat()
  return (
    <button
      type="button"
      onClick={() =>
        repeat.mutate({ queueKey: 'summons', entryId: '1', autoRejoin: true })
      }
    >
      Повторять
    </button>
  )
}

function renderActions(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <Actions />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  mocks.callApi.mockReset()
})

describe('КХ queue actions', () => {
  it('updates automatic rejoin immediately while saving', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const queues: KhQueuesResponse = {
      queues: Object.fromEntries(
        KH_QUEUE_IDS.map((queueKey) => [
          queueKey,
          { items: [], nextCursor: null },
        ]),
      ) as unknown as KhQueuesResponse['queues'],
    }
    queues.queues.summons.items.push({
      id: '1',
      userId: '00000000-0000-4000-8000-000000000001',
      gameNickname: 'Участник',
      autoRejoin: false,
    })
    client.setQueryData(['kh', 'queues'], {
      pages: [queues],
      pageParams: [null],
    })
    mocks.callApi.mockImplementation(() => new Promise(() => undefined))
    render(
      <QueryClientProvider client={client}>
        <RepeatAction />
      </QueryClientProvider>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Повторять' }))

    expect(
      client.getQueryData<{
        pages: KhQueuesResponse[]
        pageParams: unknown[]
      }>(['kh', 'queues'])?.pages[0]?.queues.summons.items[0]?.autoRejoin,
    ).toBe(true)
    client.clear()
  })

  it('updates occupied cells immediately and restores the page scroll after joining', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    client.setQueryData(settingsKey, {
      maxActiveQueues: 1,
      activeQueueCount: 0,
    })
    let resolveRequest: ((value: unknown) => void) | undefined
    mocks.callApi.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve
        }),
    )
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 640 })
    const scrollTo = vi
      .spyOn(window, 'scrollTo')
      .mockImplementation(() => undefined)
    renderActions(client)

    await userEvent.click(screen.getByRole('button', { name: 'Встать' }))

    expect(client.getQueryData(settingsKey)).toEqual({
      maxActiveQueues: 1,
      activeQueueCount: 1,
    })
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 })
    resolveRequest?.({ entryId: '1' })
    await waitFor(() =>
      expect(scrollTo).toHaveBeenCalledWith({
        left: 0,
        top: 640,
        behavior: 'auto',
      }),
    )
    client.clear()
    scrollTo.mockRestore()
  })

  it('makes a released cell available immediately', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    client.setQueryData(settingsKey, {
      maxActiveQueues: 1,
      activeQueueCount: 1,
    })
    mocks.callApi.mockResolvedValue({ ok: true })
    renderActions(client)

    await userEvent.click(screen.getByRole('button', { name: 'Уйти' }))

    expect(client.getQueryData(settingsKey)).toEqual({
      maxActiveQueues: 1,
      activeQueueCount: 0,
    })
    client.clear()
  })
})
