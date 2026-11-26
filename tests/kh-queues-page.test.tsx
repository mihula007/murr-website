import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { KH_QUEUE_IDS, type KhQueuesResponse } from '@contracts/kh'
import { AppError } from '@/lib/errors'
import { renderApp } from './support/render-app'

const mocks = vi.hoisted(() => ({
  callApi: vi.fn<(route: string, body?: unknown) => Promise<unknown>>(),
  toast: vi.fn<(message: string) => void>(),
}))

vi.mock('@/components/ui/toaster', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: mocks.toast,
}))
vi.mock('@/lib/supabase/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  callApi: mocks.callApi,
}))

const queues: KhQueuesResponse = {
  queues: Object.fromEntries(
    KH_QUEUE_IDS.map((queueKey) => [queueKey, { items: [], nextCursor: null }]),
  ) as unknown as KhQueuesResponse['queues'],
}

afterEach(() => {
  mocks.callApi.mockReset()
  mocks.toast.mockReset()
})

describe('KhQueuesPage', () => {
  it('renders the proposed header, reward background, tabs, limit, and count', async () => {
    mocks.callApi.mockImplementation((route) => {
      if (route === 'kh/queues') {
        return Promise.resolve(queues)
      }
      if (route === 'kh/settings') {
        return Promise.resolve({ maxActiveQueues: 2, activeQueueCount: 0 })
      }
      return Promise.resolve({ ok: true })
    })

    await renderApp({ role: 'admin', path: '/kh' })

    const hero = await screen.findByTestId('kh-hero')
    expect(hero).toHaveClass('min-w-0', 'overflow-hidden')
    expect(
      hero.querySelector('img[src="/kh-rewards/kh-hall-background.png"]'),
    ).not.toBeNull()
    expect(
      screen.getByRole('heading', { name: 'Очередь наград КХ' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Очередь' })).toBeInTheDocument()
    expect(
      screen.getByRole('tab', { name: 'История выдачи' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('region', { name: 'Настройка лимита очередей' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Занято ячеек: 0 из 2')).toBeInTheDocument()
  })

  it('shows a compact message instead of a blocking error for a full limit', async () => {
    mocks.callApi.mockImplementation((route) => {
      if (route === 'kh/queues') {
        return Promise.resolve(queues)
      }
      if (route === 'kh/settings') {
        return Promise.resolve({ maxActiveQueues: 1, activeQueueCount: 0 })
      }
      if (route === 'kh/join') {
        return Promise.reject(new AppError('state_conflict'))
      }
      return Promise.resolve({ ok: true })
    })

    await renderApp({ role: 'member', path: '/kh' })
    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Встать в очередь «призывы»',
      }),
    )

    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        'Лимит очередей достигнут. Список обновлён.',
      ),
    )
    expect(
      screen.queryByRole('heading', { name: 'Не удалось обновить очередь' }),
    ).not.toBeInTheDocument()
    expect(mocks.callApi).toHaveBeenCalledWith('kh/queues', {})
    expect(mocks.callApi).toHaveBeenCalledWith('kh/settings')
  })
})
