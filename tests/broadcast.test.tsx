import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BroadcastTemplate } from '@contracts/broadcasts'
import { addFiles } from '@/features/broadcast/files'
import { AppError } from '@/lib/errors'
import { renderApp } from './support/render-app'

const callApi = vi.hoisted(() =>
  vi.fn<(route: string, body?: unknown) => Promise<unknown>>(),
)
vi.mock('@/lib/supabase/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  callApi,
}))
const toast = vi.hoisted(() => vi.fn<(message: string) => void>())
vi.mock('@/components/ui/toaster', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast,
}))

type Handler = (body: unknown) => unknown
let routes: Record<string, Handler> = {}

const template: BroadcastTemplate = {
  id: 't1',
  name: 'Сбор',
  subject: 'Сбор на рейд',
  body: 'Собираемся в 20:00',
  channels: ['telegram'],
  author: { gameNickname: 'Зам' },
  canDelete: true,
}

beforeEach(() => {
  toast.mockReset()
  routes = {
    'broadcasts/drafts': () => ({ items: [] }),
    'broadcasts/templates': () => ({ items: [template] }),
    'broadcasts/save-draft': () => ({ items: [] }),
  }
  callApi.mockReset()
  callApi.mockImplementation((route, body) => {
    const handler = routes[route]
    if (!handler) {
      return Promise.reject(new AppError('not_found'))
    }
    try {
      return Promise.resolve(handler(body))
    } catch (error) {
      return Promise.reject(error)
    }
  })
})

const file = (name: string, size = 100, lastModified = 1) => ({
  name,
  size,
  type: '',
  lastModified,
})

describe('broadcast files (BRC-08)', () => {
  it('accepts allowed files, rejects type, size and the 11th, skips repeats', () => {
    const first = addFiles(
      [],
      [file('plan.xlsx'), file('virus.exe'), file('big.png', 21 * 1024 * 1024)],
    )
    expect(first.accepted.map((item) => item.name)).toEqual(['plan.xlsx'])
    expect(first.rejected).toEqual([
      { name: 'virus.exe', reason: 'file_type' },
      { name: 'big.png', reason: 'file_too_large' },
    ])
    const repeat = addFiles(first.accepted, [file('plan.xlsx')])
    expect(repeat.accepted).toHaveLength(1)
    expect(repeat.rejected).toEqual([])
    const many = addFiles(
      [],
      Array.from({ length: 11 }, (_, i) => file(`f${i}.txt`, 10, i)),
    )
    expect(many.accepted).toHaveLength(10)
    expect(many.rejected).toEqual([{ name: 'f10.txt', reason: 'too_many' }])
  })
})

describe('broadcast page (BRC, E2E-07)', () => {
  it('is closed to members', async () => {
    await renderApp({ role: 'member', path: '/broadcast' })
    expect(await screen.findByText('Нет доступа')).toBeVisible()
  })

  it('requires text and a channel and never claims sending', async () => {
    await renderApp({ role: 'officer', path: '/broadcast' })
    const send = await screen.findByRole('button', {
      name: 'Отправить рассылку',
    })
    expect(send).toBeDisabled()
    for (const channel of ['Telegram', 'ВКонтакте', 'MAX']) {
      const box = screen.getByRole('checkbox', { name: channel })
      expect(box).toBeChecked()
      fireEvent.click(box)
    }
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить черновик' }))
    expect(await screen.findByText('Заполните поле')).toBeVisible()
    expect(screen.getByText('Выберите хотя бы один канал')).toBeVisible()
    expect(callApi).not.toHaveBeenCalledWith(
      'broadcasts/save-draft',
      expect.anything(),
    )

    fireEvent.change(screen.getByLabelText('Текст рассылки'), {
      target: { value: 'Сбор в 20:00' },
    })
    fireEvent.click(screen.getByRole('checkbox', { name: 'MAX' }))
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить черновик' }))
    await waitFor(() =>
      expect(callApi).toHaveBeenCalledWith('broadcasts/save-draft', {
        subject: '',
        body: 'Сбор в 20:00',
        channels: ['max'],
        attachments: [],
        source: null,
      }),
    )
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        'Сохранено как черновик, не отправлено',
      ),
    )
  })

  it('fills the form from an event and keeps files when applying a template', async () => {
    routes['broadcasts/prefill'] = () => ({
      subject: 'Рейд',
      body: 'Рейд\nТип: PvE',
      recipients: null,
    })
    await renderApp({
      role: 'officer',
      path: '/broadcast?source=event&id=00000000-0000-4000-8000-000000000001',
    })
    expect(await screen.findByDisplayValue('Рейд')).toBeVisible()
    expect(callApi).toHaveBeenCalledWith('broadcasts/prefill', {
      source: 'event',
      id: '00000000-0000-4000-8000-000000000001',
    })
    const input = document.getElementById('broadcast-files') as HTMLInputElement
    fireEvent.change(input, {
      target: {
        files: [new File(['x'], 'plan.xlsx'), new File(['x'], 'run.exe')],
      },
    })
    const list = await screen.findByRole('list', { name: 'Выбранные файлы' })
    expect(within(list).getByText('plan.xlsx')).toBeVisible()
    expect(screen.getByText('run.exe: неподдерживаемый тип')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Применить' }))
    expect(await screen.findByDisplayValue('Сбор на рейд')).toBeVisible()
    expect(screen.getByRole('checkbox', { name: 'Telegram' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'MAX' })).not.toBeChecked()
    expect(within(list).getByText('plan.xlsx')).toBeVisible()
  })

  it('explains a closed source', async () => {
    routes['broadcasts/prefill'] = () => {
      throw new AppError('state_conflict')
    }
    await renderApp({
      role: 'admin',
      path: '/broadcast?source=vote&id=00000000-0000-4000-8000-000000000002',
    })
    expect(await screen.findByText(/Подготовить рассылку нельзя/)).toBeVisible()
  })
})
