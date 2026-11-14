import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BroadcastTemplate } from '@contracts/broadcasts'
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

describe('broadcast page (BRC, E2E-07)', () => {
  it('is closed to members', async () => {
    await renderApp({ role: 'member', path: '/broadcast' })
    expect(await screen.findByText('Нет доступа')).toBeVisible()
  })

  it('saves a Telegram draft; VK and MAX are not connected (Q-82)', async () => {
    await renderApp({ role: 'officer', path: '/broadcast' })
    const telegram = await screen.findByRole('checkbox', { name: 'Telegram' })
    expect(telegram).toBeChecked()
    for (const channel of [/ВКонтакте/, /MAX/]) {
      const box = screen.getByRole('checkbox', { name: channel })
      expect(box).toBeDisabled()
      expect(box).not.toBeChecked()
    }
    fireEvent.click(telegram)
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить черновик' }))
    expect(await screen.findByText('Заполните поле')).toBeVisible()
    expect(screen.getByText('Выберите хотя бы один канал')).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Отправить в Telegram' }),
    ).toBeDisabled()
    expect(callApi).not.toHaveBeenCalledWith(
      'broadcasts/save-draft',
      expect.anything(),
    )

    fireEvent.change(screen.getByLabelText('Текст рассылки'), {
      target: { value: 'Сбор в 20:00' },
    })
    fireEvent.click(telegram)
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить черновик' }))
    await waitFor(() =>
      expect(callApi).toHaveBeenCalledWith('broadcasts/save-draft', {
        subject: '',
        body: 'Сбор в 20:00',
        channels: ['telegram'],
        source: null,
      }),
    )
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        'Сохранено как черновик, не отправлено',
      ),
    )
    expect(callApi).not.toHaveBeenCalledWith(
      'broadcasts/send',
      expect.anything(),
    )
  })

  it('sends a standalone announcement after confirming the recipients', async () => {
    routes['broadcasts/recipients'] = () => ({ count: 3 })
    routes['broadcasts/send'] = () => ({ recipients: 3, sent: 3, failed: 0 })
    await renderApp({ role: 'officer', path: '/broadcast' })
    const send = await screen.findByRole('button', {
      name: 'Отправить в Telegram',
    })
    fireEvent.click(send)
    expect(await screen.findByText('Заполните поле')).toBeVisible()
    expect(callApi).not.toHaveBeenCalledWith(
      'broadcasts/recipients',
      expect.anything(),
    )

    fireEvent.change(screen.getByLabelText('Тема (необязательно)'), {
      target: { value: 'Сбор' },
    })
    fireEvent.change(screen.getByLabelText('Текст рассылки'), {
      target: { value: 'Сегодня в 20:00' },
    })
    fireEvent.click(send)
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/Получателей: 3/)).toBeVisible()
    expect(within(dialog).getByText(/текстом без кнопок/)).toBeVisible()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отправить' }))
    await waitFor(() =>
      expect(callApi).toHaveBeenCalledWith('broadcasts/send', {
        subject: 'Сбор',
        body: 'Сегодня в 20:00',
        eventId: null,
      }),
    )
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith('Отправлено в Telegram: 3'),
    )
    expect(screen.getByLabelText('Текст рассылки')).toHaveValue('')
  })

  it('explains when nobody has linked Telegram', async () => {
    routes['broadcasts/recipients'] = () => ({ count: 0 })
    await renderApp({ role: 'admin', path: '/broadcast' })
    fireEvent.change(await screen.findByLabelText('Текст рассылки'), {
      target: { value: 'Сбор' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Отправить в Telegram' }),
    )
    expect(await screen.findByText(/Отправить некому/)).toBeVisible()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('sends an event announcement with buttons until the link is removed', async () => {
    routes['broadcasts/prefill'] = () => ({
      subject: 'Рейд',
      body: 'Рейд\nТип: PvE',
      recipients: null,
    })
    routes['broadcasts/recipients'] = () => ({ count: 2 })
    routes['broadcasts/send'] = () => {
      throw new AppError('state_conflict', { reason: 'started' })
    }
    const id = '00000000-0000-4000-8000-000000000001'
    await renderApp({
      role: 'officer',
      path: `/broadcast?source=event&id=${id}`,
    })
    expect(await screen.findByText(/Анонс события/)).toBeVisible()
    fireEvent.click(
      screen.getByRole('button', { name: 'Отправить в Telegram' }),
    )
    let dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/с кнопками ответа/)).toBeVisible()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отправить' }))
    expect(
      await within(dialog).findByText(/Событие уже началось/),
    ).toBeVisible()
    expect(callApi).toHaveBeenCalledWith('broadcasts/send', {
      subject: 'Рейд',
      body: 'Рейд\nТип: PvE',
      eventId: id,
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: 'Снять связь' }))
    expect(screen.queryByText(/Анонс события/)).toBeNull()
    routes['broadcasts/send'] = () => ({ recipients: 2, sent: 1, failed: 1 })
    fireEvent.click(
      screen.getByRole('button', { name: 'Отправить в Telegram' }),
    )
    dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отправить' }))
    await waitFor(() =>
      expect(callApi).toHaveBeenLastCalledWith('broadcasts/send', {
        subject: 'Рейд',
        body: 'Рейд\nТип: PvE',
        eventId: null,
      }),
    )
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        'Отправлено в Telegram: 1, не доставлено: 1',
      ),
    )
  })

  it('fills the form from an event and applies a template', async () => {
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
    fireEvent.click(await screen.findByRole('button', { name: 'Применить' }))
    expect(await screen.findByDisplayValue('Сбор на рейд')).toBeVisible()
    expect(screen.getByRole('checkbox', { name: 'Telegram' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /MAX/ })).not.toBeChecked()
    expect(screen.queryByText('Файлы')).toBeNull()
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
