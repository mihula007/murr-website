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

/** Ответ `broadcasts/recipients`: получатели по каналам (MAX-05). */
const recipients = (telegram: number, max: number, maxConfigured = true) => ({
  count: telegram,
  channels: {
    telegram: { configured: true, count: telegram },
    max: { configured: maxConfigured, count: max },
  },
})
const SEND = 'Отправить анонс'

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

  it('saves a draft; Telegram and MAX are chosen, VK is not connected (Q-82, Q-97)', async () => {
    await renderApp({ role: 'officer', path: '/broadcast' })
    const telegram = await screen.findByRole('checkbox', { name: 'Telegram' })
    const max = screen.getByRole('checkbox', { name: 'MAX' })
    expect(telegram).toBeChecked()
    expect(max).toBeChecked()
    const vk = screen.getByRole('checkbox', { name: /ВКонтакте/ })
    expect(vk).toBeDisabled()
    expect(vk).not.toBeChecked()
    fireEvent.click(telegram)
    fireEvent.click(max)
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить черновик' }))
    expect(await screen.findByText('Заполните поле')).toBeVisible()
    expect(screen.getByText('Выберите хотя бы один канал')).toBeVisible()
    expect(screen.getByRole('button', { name: SEND })).toBeDisabled()
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
    routes['broadcasts/recipients'] = () => recipients(3, 2)
    routes['broadcasts/send'] = () => ({
      recipients: 5,
      sent: 5,
      failed: 0,
      channels: {
        telegram: { recipients: 3, sent: 3, failed: 0 },
        max: { recipients: 2, sent: 2, failed: 0 },
      },
    })
    await renderApp({ role: 'officer', path: '/broadcast' })
    const send = await screen.findByRole('button', { name: SEND })
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
    expect(
      within(dialog).getByText(/Получателей — Telegram: 3, MAX: 2/),
    ).toBeVisible()
    expect(within(dialog).getByText(/текстом без кнопок/)).toBeVisible()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отправить' }))
    await waitFor(() =>
      expect(callApi).toHaveBeenCalledWith('broadcasts/send', {
        subject: 'Сбор',
        body: 'Сегодня в 20:00',
        eventId: null,
        channels: ['telegram', 'max'],
      }),
    )
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith('Отправлено — Telegram: 3, MAX: 2'),
    )
    expect(screen.getByLabelText('Текст рассылки')).toHaveValue('')
  })

  it('explains when nobody has linked the chosen messengers', async () => {
    routes['broadcasts/recipients'] = () => recipients(0, 4)
    await renderApp({ role: 'admin', path: '/broadcast' })
    fireEvent.change(await screen.findByLabelText('Текст рассылки'), {
      target: { value: 'Сбор' },
    })
    fireEvent.click(screen.getByRole('checkbox', { name: 'MAX' }))
    fireEvent.click(screen.getByRole('button', { name: SEND }))
    expect(await screen.findByText(/Отправить некому/)).toBeVisible()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('asks to untick a channel that is not configured on the server (MAX-05)', async () => {
    routes['broadcasts/recipients'] = () => recipients(2, 0, false)
    await renderApp({ role: 'admin', path: '/broadcast' })
    fireEvent.change(await screen.findByLabelText('Текст рассылки'), {
      target: { value: 'Сбор' },
    })
    fireEvent.click(screen.getByRole('button', { name: SEND }))
    expect(await screen.findByText(/MAX не подключён на сервере/)).toBeVisible()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: 'MAX' }))
    fireEvent.click(screen.getByRole('button', { name: SEND }))
    const dialog = await screen.findByRole('alertdialog')
    expect(
      within(dialog).getByText(/Получателей — Telegram: 2\./),
    ).toBeVisible()
  })

  it('sends an event announcement with buttons until the link is removed', async () => {
    routes['broadcasts/prefill'] = () => ({
      subject: 'Рейд',
      body: 'Рейд\nТип: PvE',
      recipients: null,
    })
    routes['broadcasts/recipients'] = () => recipients(2, 1)
    routes['broadcasts/send'] = () => {
      throw new AppError('state_conflict', { reason: 'started' })
    }
    const id = '00000000-0000-4000-8000-000000000001'
    await renderApp({
      role: 'officer',
      path: `/broadcast?source=event&id=${id}`,
    })
    expect(await screen.findByText(/Анонс события/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: SEND }))
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
      channels: ['telegram', 'max'],
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: 'Снять связь' }))
    expect(screen.queryByText(/Анонс события/)).toBeNull()
    routes['broadcasts/send'] = () => ({
      recipients: 3,
      sent: 2,
      failed: 1,
      channels: {
        telegram: { recipients: 2, sent: 1, failed: 1 },
        max: { recipients: 1, sent: 1, failed: 0 },
      },
    })
    fireEvent.click(screen.getByRole('button', { name: SEND }))
    dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отправить' }))
    await waitFor(() =>
      expect(callApi).toHaveBeenLastCalledWith('broadcasts/send', {
        subject: 'Рейд',
        body: 'Рейд\nТип: PvE',
        eventId: null,
        channels: ['telegram', 'max'],
      }),
    )
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        'Отправлено — Telegram: 1, MAX: 1. Не доставлено: 1',
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
    // В шаблоне только Telegram: MAX снимается (BRC-11).
    expect(screen.getByRole('checkbox', { name: 'MAX' })).not.toBeChecked()
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
