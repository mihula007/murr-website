import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
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
const recipients = (
  telegram: number,
  max: number,
  maxConfigured = true,
  vk = 0,
) => ({
  count: telegram,
  channels: {
    telegram: { configured: true, count: telegram },
    vk: { configured: true, count: vk },
    max: { configured: maxConfigured, count: max },
  },
  items: [],
  nextCursor: null,
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
    'catalog/classes': () => ({ classes: [] }),
    'broadcasts/recipients': () => recipients(0, 0),
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

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => 900,
  })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 400,
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get: () => 2_000,
  })
})

afterAll(() => {
  Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight')
  Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth')
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight')
})

describe('broadcast page (BRC, E2E-07)', () => {
  it('is closed to members', async () => {
    await renderApp({ role: 'member', path: '/broadcast' })
    expect(await screen.findByText('Нет доступа')).toBeVisible()
  })

  it('shows subscriptions as a separate block in preparation', async () => {
    routes['broadcasts/subscriptions'] = () => ({
      items: [
        {
          id: 'member-1',
          gameNickname: 'Ничего не привязано',
          role: 'member',
          telegram: { linked: false, blocked: false },
          vk: { linked: false, blocked: false },
          max: { linked: false, blocked: false },
        },
        {
          id: 'member-2',
          gameNickname: 'Telegram подключён',
          role: 'officer',
          telegram: { linked: true, blocked: false },
          vk: { linked: true, blocked: true },
          max: { linked: false, blocked: false },
        },
      ],
      nextCursor: null,
    })
    await renderApp({ role: 'officer', path: '/broadcast' })
    expect(screen.queryByRole('tab', { name: 'Подписки' })).toBeNull()
    const subscriptions = await screen.findByRole('region', {
      name: 'Подписки на рассылки',
    })
    const recipients = screen.getByRole('region', {
      name: 'Исключения получателей',
    })
    expect(subscriptions).toBeVisible()
    expect(recipients).toBeVisible()
    expect(within(subscriptions).queryByLabelText('Поиск по нику')).toBeNull()
    expect(within(recipients).queryByLabelText('Поиск по нику')).toBeNull()
    await waitFor(() =>
      expect(callApi).toHaveBeenCalledWith('broadcasts/subscriptions', {
        cursor: null,
      }),
    )
    const unlinked = await screen.findByText('Ничего не привязано')
    const row = unlinked.closest('li')
    expect(row?.firstElementChild).toHaveClass('bg-item-highlight!')
    expect(
      screen.getByRole('group', { name: 'Telegram: не привязан' }),
    ).toBeVisible()
    expect(
      screen.getByRole('group', { name: 'Telegram: привязан' }),
    ).toBeVisible()
    expect(
      screen.getByRole('group', { name: 'ВКонтакте: сообщения недоступны' }),
    ).toBeVisible()
    const scrollRegion = screen.getByRole('region', {
      name: 'Прокручиваемый список: Участники и привязки мессенджеров',
    })
    expect(scrollRegion).toHaveAttribute('data-viewport-rows', '15')
    expect(
      within(screen.getByRole('group', { name: 'Подписи каналов' })).getByText(
        'ВКонтакте',
      ),
    ).toHaveClass('min-w-0', 'break-words')
  })

  it('keeps the subscriptions list mounted when the filter request fails', async () => {
    const requests: unknown[] = []
    routes['broadcasts/subscriptions'] = (body) => {
      requests.push(body)
      if ((body as { unlinkedOnly?: boolean }).unlinkedOnly) {
        throw new Error('offline')
      }
      return {
        items: Array.from({ length: 24 }, (_, index) => ({
          id: `member-error-${index}`,
          gameNickname: `Участник ошибки ${index}`,
          role: 'member',
          telegram: { linked: true, blocked: false },
          vk: { linked: false, blocked: false },
          max: { linked: false, blocked: false },
        })),
        nextCursor: null,
      }
    }
    await renderApp({ role: 'admin', path: '/broadcast' })
    const filter = await screen.findByRole('checkbox', {
      name: 'Показать без подписки',
    })
    expect(await screen.findByText('Участник ошибки 0')).toBeVisible()
    const scrollRegion = await screen.findByRole('region', {
      name: 'Прокручиваемый список: Участники и привязки мессенджеров',
    })
    scrollRegion.scrollTop = 160

    fireEvent.click(filter)
    await waitFor(() =>
      expect(requests).toContainEqual({ cursor: null, unlinkedOnly: true }),
    )

    expect(
      await screen.findByRole('alert', {}, { timeout: 10_000 }),
    ).toBeVisible()
    expect(screen.getByText('Участник ошибки 0')).toBeVisible()
    expect(scrollRegion).toBeInTheDocument()
    expect(scrollRegion.scrollTop).toBe(160)
  }, 15_000)

  it('ignores an obsolete nickname search parameter', async () => {
    const requests: unknown[] = []
    routes['broadcasts/subscriptions'] = (body) => {
      requests.push(body)
      return { items: [], nextCursor: null }
    }
    const { router } = await renderApp({
      role: 'admin',
      path: '/broadcast?q=TestNick',
    })
    const subscriptions = await screen.findByRole('region', {
      name: 'Подписки на рассылки',
    })
    expect(within(subscriptions).queryByLabelText('Поиск по нику')).toBeNull()
    expect(router.state.location.search.q).toBe('TestNick')
    await waitFor(() => expect(requests).toContainEqual({ cursor: null }))
    expect(requests).not.toContainEqual(
      expect.objectContaining({ search: expect.anything() }),
    )
  })

  it('filters subscriptions without losing the current scroll container', async () => {
    const requests: unknown[] = []
    let finishFilter: (response: unknown) => void = () => undefined
    routes['broadcasts/subscriptions'] = (body) => {
      requests.push(body)
      if ((body as { unlinkedOnly?: boolean }).unlinkedOnly) {
        return new Promise((resolve) => {
          finishFilter = resolve
        })
      }
      return {
        items: Array.from({ length: 24 }, (_, index) => ({
          id: `member-${index}`,
          gameNickname: `Участник ${index}`,
          role: 'member',
          telegram: { linked: true, blocked: false },
          vk: { linked: false, blocked: false },
          max: { linked: false, blocked: false },
        })),
        nextCursor: null,
      }
    }
    const { router } = await renderApp({
      role: 'admin',
      path: '/broadcast',
    })
    const filter = await screen.findByRole('checkbox', {
      name: 'Показать без подписки',
    })
    expect(filter).not.toBeChecked()
    const scrollRegion = await screen.findByRole('region', {
      name: 'Прокручиваемый список: Участники и привязки мессенджеров',
    })
    const subject = screen.getByLabelText('Тема (необязательно)')
    fireEvent.change(subject, { target: { value: 'Не терять эту тему' } })
    scrollRegion.scrollTop = 180
    const pageScroll = vi
      .spyOn(window, 'scrollTo')
      .mockImplementation(() => undefined)
    pageScroll.mockClear()

    try {
      fireEvent.click(filter)

      await waitFor(() =>
        expect(router.state.location.search).toMatchObject({
          unlinkedOnly: true,
        }),
      )
      await waitFor(() =>
        expect(requests).toContainEqual({
          cursor: null,
          unlinkedOnly: true,
        }),
      )
      expect(screen.queryByRole('alertdialog')).toBeNull()
      expect(subject).toHaveValue('Не терять эту тему')
      expect(pageScroll).not.toHaveBeenCalled()
      expect(scrollRegion).toBeInTheDocument()
      expect(scrollRegion.scrollTop).toBe(180)
    } finally {
      pageScroll.mockRestore()
    }
    finishFilter({
      items: [
        {
          id: 'unlinked-member',
          gameNickname: 'Без связи',
          role: 'member',
          telegram: { linked: false, blocked: false },
          vk: { linked: false, blocked: false },
          max: { linked: false, blocked: false },
        },
      ],
      nextCursor: null,
    })
    expect(await screen.findByText('Без связи')).toBeVisible()
  })

  it('saves a draft; all three channels are chosen (Q-99, Q-102)', async () => {
    await renderApp({ role: 'officer', path: '/broadcast' })
    const telegram = await screen.findByRole('checkbox', { name: 'Telegram' })
    const max = screen.getByRole('checkbox', { name: 'MAX' })
    const vk = screen.getByRole('checkbox', { name: 'ВКонтакте' })
    for (const box of [telegram, vk, max]) {
      expect(box).toBeChecked()
      expect(box).toBeEnabled()
    }
    fireEvent.click(telegram)
    fireEvent.click(vk)
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

  it('excludes one person from every chosen channel and keeps it after cancel', async () => {
    const excludedId = '00000000-0000-4000-8000-000000000011'
    const rows = [
      {
        id: excludedId,
        gameNickname: 'Альфа',
        channels: ['telegram', 'max'],
      },
      {
        id: '00000000-0000-4000-8000-000000000012',
        gameNickname: 'Бета',
        channels: ['telegram'],
      },
      {
        id: '00000000-0000-4000-8000-000000000013',
        gameNickname: 'Гамма',
        channels: ['max'],
      },
    ]
    routes['broadcasts/recipients'] = (body) => {
      const excluded =
        (body as { excludedUserIds?: string[] } | undefined)?.excludedUserIds ??
        []
      return {
        ...recipients(
          2 - Number(excluded.includes(rows[0]!.id)),
          2 - Number(excluded.includes(rows[0]!.id)),
        ),
        items: rows,
        nextCursor: null,
      }
    }
    routes['broadcasts/send'] = () => ({
      recipients: 2,
      sent: 2,
      failed: 0,
      channels: {
        telegram: { recipients: 1, sent: 1, failed: 0 },
        max: { recipients: 1, sent: 1, failed: 0 },
      },
    })

    await renderApp({ role: 'officer', path: '/broadcast' })
    const excluded = await screen.findByRole('checkbox', {
      name: 'Получит: Альфа',
    })
    expect(excluded).toBeChecked()
    fireEvent.click(excluded)
    expect(excluded).not.toBeChecked()
    expect(
      screen.getByText(
        /Получателей по каналам: Telegram: 1, ВКонтакте: 0, MAX: 1/,
      ),
    ).toBeVisible()

    fireEvent.change(screen.getByLabelText('Текст рассылки'), {
      target: { value: 'Сбор' },
    })
    fireEvent.click(screen.getByRole('button', { name: SEND }))
    const dialog = await screen.findByRole('alertdialog')
    expect(
      within(dialog).getByText(
        /Получателей — Telegram: 1, ВКонтакте: 0, MAX: 1/,
      ),
    ).toBeVisible()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(excluded).not.toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: SEND }))
    const confirm = await screen.findByRole('alertdialog')
    fireEvent.click(within(confirm).getByRole('button', { name: 'Отправить' }))
    await waitFor(() =>
      expect(callApi).toHaveBeenCalledWith(
        'broadcasts/send',
        expect.objectContaining({
          excludedUserIds: [excludedId],
        }),
      ),
    )
  })

  it('shows the approved message when exclusions leave no recipients', async () => {
    const personId = '00000000-0000-4000-8000-000000000014'
    routes['broadcasts/recipients'] = (body) => {
      const excluded =
        (body as { excludedUserIds?: string[] } | undefined)?.excludedUserIds ??
        []
      return {
        ...recipients(excluded.includes(personId) ? 0 : 1, 0),
        items: excluded.includes(personId)
          ? []
          : [{ id: personId, gameNickname: 'Один', channels: ['telegram'] }],
        nextCursor: null,
      }
    }
    await renderApp({ role: 'officer', path: '/broadcast' })
    fireEvent.click(
      await screen.findByRole('checkbox', { name: 'Получит: Один' }),
    )
    fireEvent.change(screen.getByLabelText('Текст рассылки'), {
      target: { value: 'Объявление' },
    })

    fireEvent.click(screen.getByRole('button', { name: SEND }))
    expect(
      await screen.findByText('После исключений получателей не осталось'),
    ).toBeVisible()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(callApi).not.toHaveBeenCalledWith(
      'broadcasts/send',
      expect.anything(),
    )
  })

  it('filters the visible list by class and preserves exclusions across classes', async () => {
    const requests: Array<Record<string, unknown>> = []
    const rows = [
      {
        id: '00000000-0000-4000-8000-000000000015',
        gameNickname: 'Воин 1',
        channels: ['telegram'],
        classId: 1,
      },
      {
        id: '00000000-0000-4000-8000-000000000016',
        gameNickname: 'Маг 1',
        channels: ['telegram'],
        classId: 2,
      },
    ]
    routes['catalog/classes'] = () => ({
      classes: [
        { id: 1, name: 'Воин', slug: 'warrior' },
        { id: 2, name: 'Маг', slug: 'mage' },
      ],
    })
    routes['broadcasts/recipients'] = (body) => {
      const request = body as Record<string, unknown>
      requests.push(request)
      return {
        ...recipients(2, 0),
        items: request.classId
          ? rows.filter((item) => item.classId === request.classId)
          : rows,
        nextCursor: null,
      }
    }

    await renderApp({ role: 'officer', path: '/broadcast' })
    const excluded = await screen.findByRole('checkbox', {
      name: 'Получит: Воин 1',
    })
    expect(
      screen.getByLabelText('Прокручиваемый список: Получатели объявления'),
    ).toHaveAttribute('data-viewport-rows', '15')
    fireEvent.click(excluded)

    const classFilter = screen.getByRole('combobox', {
      name: 'Класс получателя',
    })
    fireEvent.keyDown(classFilter, { key: 'ArrowDown' })
    fireEvent.click(screen.getByRole('option', { name: 'Маг' }))
    expect(
      await screen.findByRole('checkbox', { name: 'Получит: Маг 1' }),
    ).toBeChecked()
    await waitFor(() => expect(requests.at(-1)?.classId).toBe(2))
    expect(
      screen.queryByRole('checkbox', { name: 'Получит: Воин 1' }),
    ).toBeNull()

    fireEvent.keyDown(classFilter, { key: 'ArrowDown' })
    fireEvent.click(screen.getByRole('option', { name: 'Все классы' }))
    expect(
      await screen.findByRole('checkbox', { name: 'Получит: Воин 1' }),
    ).not.toBeChecked()
    expect(
      screen.getByText(/Получателей по каналам: Telegram: 1/),
    ).toBeVisible()
  })

  it('bulk marks every page of one class and preserves exclusions from other classes', async () => {
    const rows = {
      mage: {
        id: '00000000-0000-4000-8000-000000000031',
        gameNickname: 'Маг',
        channels: ['telegram'],
        classId: 2,
      },
      warrior1: {
        id: '00000000-0000-4000-8000-000000000032',
        gameNickname: 'Воин 1',
        channels: ['telegram'],
        classId: 1,
      },
      warrior2: {
        id: '00000000-0000-4000-8000-000000000033',
        gameNickname: 'Воин 2',
        channels: ['telegram'],
        classId: 1,
      },
    }
    const requests: Array<Record<string, unknown>> = []
    routes['catalog/classes'] = () => ({
      classes: [
        { id: 1, name: 'Воин', slug: 'warrior' },
        { id: 2, name: 'Маг', slug: 'mage' },
      ],
    })
    routes['broadcasts/recipients'] = (body) => {
      const request = body as Record<string, unknown>
      requests.push(request)
      const page =
        request.classId === 1
          ? request.cursor
            ? { items: [rows.warrior2], nextCursor: null }
            : { items: [rows.warrior1], nextCursor: 'warrior-page-2' }
          : request.cursor
            ? { items: [rows.warrior2], nextCursor: null }
            : { items: [rows.mage, rows.warrior1], nextCursor: 'all-page-2' }
      return { ...recipients(3, 0), ...page }
    }

    await renderApp({ role: 'officer', path: '/broadcast' })
    fireEvent.click(
      await screen.findByRole('checkbox', { name: 'Получит: Маг' }),
    )
    const classFilter = screen.getByRole('combobox', {
      name: 'Класс получателя',
    })
    fireEvent.keyDown(classFilter, { key: 'ArrowDown' })
    fireEvent.click(screen.getByRole('option', { name: 'Воин' }))
    expect(
      await screen.findByRole('checkbox', { name: 'Получит: Воин 1' }),
    ).toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: 'Снять отметки' }))
    await waitFor(() =>
      expect(requests).toContainEqual(
        expect.objectContaining({ cursor: 'warrior-page-2', classId: 1 }),
      ),
    )
    await waitFor(() =>
      expect(
        screen.getByText(/Получателей по каналам: Telegram: 0/),
      ).toBeVisible(),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Отметить всех' }))
    await waitFor(() =>
      expect(
        screen.getByText(/Получателей по каналам: Telegram: 2/),
      ).toBeVisible(),
    )

    fireEvent.keyDown(classFilter, { key: 'ArrowDown' })
    fireEvent.click(screen.getByRole('option', { name: 'Все классы' }))
    fireEvent.click(screen.getByRole('button', { name: 'Снять отметки' }))
    await waitFor(() =>
      expect(requests).toContainEqual(
        expect.objectContaining({ cursor: 'all-page-2' }),
      ),
    )
    await waitFor(() =>
      expect(
        screen.getByText(/Получателей по каналам: Telegram: 0/),
      ).toBeVisible(),
    )
  })

  it('disables recipient toggles while loading pages for a bulk update', async () => {
    let finishPage: (response: unknown) => void = () => undefined
    routes['broadcasts/recipients'] = (body) => {
      const request = body as Record<string, unknown>
      if (request.cursor) {
        return new Promise((resolve) => {
          finishPage = resolve
        })
      }
      return {
        ...recipients(2, 0),
        items: [
          {
            id: '00000000-0000-4000-8000-000000000041',
            gameNickname: 'Первая страница',
            channels: ['telegram'],
          },
        ],
        nextCursor: 'page-2',
      }
    }

    await renderApp({ role: 'officer', path: '/broadcast' })
    const row = await screen.findByRole('checkbox', {
      name: 'Получит: Первая страница',
    })
    fireEvent.click(screen.getByRole('button', { name: 'Снять отметки' }))
    await waitFor(() => expect(row).toBeDisabled())
    expect(row).toBeChecked()
    finishPage({
      ...recipients(2, 0),
      items: [
        {
          id: '00000000-0000-4000-8000-000000000042',
          gameNickname: 'Вторая страница',
          channels: ['telegram'],
        },
      ],
      nextCursor: null,
    })
    await waitFor(() => expect(row).not.toBeChecked())
  })

  it('omits the recipient heading and displays channel names beside nicknames', async () => {
    routes['broadcasts/recipients'] = () => ({
      ...recipients(1, 0),
      items: [
        {
          id: '00000000-0000-4000-8000-000000000034',
          gameNickname: 'Получатель',
          channels: ['telegram'],
        },
      ],
      nextCursor: null,
    })
    await renderApp({ role: 'admin', path: '/broadcast' })
    const recipientPanel = await screen.findByRole('region', {
      name: 'Исключения получателей',
    })
    expect(
      within(recipientPanel).queryByRole('heading', { name: 'Кому отправить' }),
    ).toBeNull()
    expect(
      within(recipientPanel).queryByText(/Все подходящие участники отмечены/),
    ).toBeNull()
    expect(
      within(recipientPanel).queryByText(/Фильтр помогает найти участников/),
    ).toBeNull()
    expect(
      within(recipientPanel).getByRole('button', { name: 'Снять отметки' }),
    ).toBeVisible()
    expect(
      within(recipientPanel).getByRole('button', { name: 'Отметить всех' }),
    ).toBeVisible()
    const nickname = within(recipientPanel).getByText('Получатель')
    const channelName = within(recipientPanel).getByLabelText('Telegram', {
      selector: 'span',
    })
    expect(nickname.parentElement).toBe(channelName.parentElement)
    expect(nickname.parentElement).toHaveClass('flex', 'items-center')
    expect(nickname.closest('label')).toHaveClass('h-12')
  })

  it('paginates recipients without a nickname search field', async () => {
    const requests: Array<Record<string, unknown>> = []
    routes['broadcasts/recipients'] = (body) => {
      const request = body as Record<string, unknown>
      requests.push(request)
      return {
        ...recipients(2, 0),
        items: request.cursor
          ? [
              {
                id: '00000000-0000-4000-8000-000000000072',
                gameNickname: 'Продолжение',
                channels: ['telegram'],
              },
            ]
          : Array.from({ length: 50 }, (_, index) => ({
              id: `00000000-0000-4000-8000-${String(index + 22).padStart(12, '0')}`,
              gameNickname: index === 0 ? 'Первый' : `Участник ${index}`,
              channels: ['telegram'],
            })),
        nextCursor: request.cursor ? null : 'cursor-1',
      }
    }

    await renderApp({ role: 'admin', path: '/broadcast' })
    expect(await screen.findByText('Первый')).toBeVisible()
    const recipientScroller = screen.getByLabelText(
      'Прокручиваемый список: Получатели объявления',
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Показать ещё' }))
    await waitFor(() =>
      expect(requests).toContainEqual(
        expect.objectContaining({ cursor: 'cursor-1' }),
      ),
    )
    recipientScroller.scrollTop = 4_000
    fireEvent.scroll(recipientScroller)
    expect(await screen.findByText('Продолжение')).toBeVisible()
    expect(
      within(
        screen.getByRole('region', { name: 'Исключения получателей' }),
      ).queryByLabelText('Поиск по нику'),
    ).toBeNull()
    expect(requests.every((request) => !('search' in request))).toBe(true)
  })

  it('sends a standalone announcement after confirming the recipients', async () => {
    routes['broadcasts/recipients'] = () => recipients(3, 2, true, 1)
    routes['broadcasts/send'] = () => ({
      recipients: 6,
      sent: 6,
      failed: 0,
      channels: {
        telegram: { recipients: 3, sent: 3, failed: 0 },
        vk: { recipients: 1, sent: 1, failed: 0 },
        max: { recipients: 2, sent: 2, failed: 0 },
      },
    })
    await renderApp({ role: 'officer', path: '/broadcast' })
    const send = await screen.findByRole('button', { name: SEND })
    fireEvent.click(send)
    expect(await screen.findByText('Заполните поле')).toBeVisible()
    expect(callApi).toHaveBeenCalledWith('broadcasts/recipients', {
      cursor: null,
      channels: ['telegram', 'vk', 'max'],
    })
    expect(callApi).not.toHaveBeenCalledWith('broadcasts/recipients', undefined)

    fireEvent.change(screen.getByLabelText('Тема (необязательно)'), {
      target: { value: 'Сбор' },
    })
    fireEvent.change(screen.getByLabelText('Текст рассылки'), {
      target: { value: 'Сегодня в 20:00' },
    })
    fireEvent.click(send)
    const dialog = await screen.findByRole('alertdialog')
    expect(
      within(dialog).getByText(
        /Получателей — Telegram: 3, ВКонтакте: 1, MAX: 2/,
      ),
    ).toBeVisible()
    expect(within(dialog).getByText(/текстом без кнопок/)).toBeVisible()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отправить' }))
    await waitFor(() =>
      expect(callApi).toHaveBeenCalledWith('broadcasts/send', {
        subject: 'Сбор',
        body: 'Сегодня в 20:00',
        eventId: null,
        groupId: null,
        channels: ['telegram', 'vk', 'max'],
      }),
    )
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        'Отправлено — Telegram: 3, ВКонтакте: 1, MAX: 2',
      ),
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
      within(dialog).getByText(/Получателей — Telegram: 2, ВКонтакте: 0\./),
    ).toBeVisible()
  })

  it('sends an event announcement with buttons; the link stays (TGM-12, Q-104)', async () => {
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
    expect(screen.queryByRole('button', { name: /Снять связь/ })).toBeNull()
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
      groupId: null,
      channels: ['telegram', 'vk', 'max'],
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())

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
        eventId: id,
        groupId: null,
        channels: ['telegram', 'vk', 'max'],
      }),
    )
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        'Отправлено — Telegram: 1, MAX: 1. Не доставлено: 1',
      ),
    )
  })

  it('counts only those who have not answered the event (Q-109)', async () => {
    routes['broadcasts/prefill'] = () => ({
      subject: 'Рейд',
      body: 'Рейд',
      recipients: null,
    })
    const answered = {
      count: 0,
      channels: {
        telegram: { configured: true, count: 0, answered: 3 },
        vk: { configured: true, count: 0, answered: 0 },
        max: { configured: true, count: 0, answered: 1 },
      },
      items: [],
      nextCursor: null,
    }
    routes['broadcasts/recipients'] = () => answered
    const id = '00000000-0000-4000-8000-000000000001'
    await renderApp({
      role: 'officer',
      path: `/broadcast?source=event&id=${id}`,
    })
    expect(await screen.findByText(/кроме уже ответивших/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: SEND }))
    expect(
      await screen.findByText(
        'Отправить некому: все участники, привязавшие выбранные мессенджеры, уже ответили на событие.',
      ),
    ).toBeVisible()
    expect(callApi).toHaveBeenCalledWith('broadcasts/recipients', {
      eventId: id,
    })
    expect(screen.queryByRole('alertdialog')).toBeNull()

    // Ответили, пока было открыто подтверждение, — отказ сервера.
    routes['broadcasts/recipients'] = () => recipients(1, 0)
    routes['broadcasts/send'] = () => {
      throw new AppError('state_conflict', { reason: 'all_answered' })
    }
    fireEvent.click(screen.getByRole('button', { name: SEND }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отправить' }))
    expect(
      await within(dialog).findByText(/уже ответили на событие/),
    ).toBeVisible()
  })

  it('sends a group announcement only to the group (BRC-04, Q-104)', async () => {
    const id = '00000000-0000-4000-8000-000000000002'
    routes['broadcasts/prefill'] = () => ({
      subject: 'Рейд — Пати 1',
      body: 'Группа «Пати 1»',
      recipients: [
        { gameNickname: 'Анна', isLeader: true },
        { gameNickname: 'Борис', isLeader: false },
      ],
    })
    const asked: unknown[] = []
    routes['broadcasts/recipients'] = (body) => {
      asked.push(body)
      return recipients(0, 0)
    }
    await renderApp({
      role: 'officer',
      path: `/broadcast?source=group&id=${id}`,
    })
    expect(
      await screen.findByText(/получат только участники группы/),
    ).toBeVisible()
    expect(screen.getByText(/Сейчас в группе: 2\./)).toBeVisible()
    expect(screen.queryByRole('button', { name: /Снять связь/ })).toBeNull()

    // Никто из группы не привязал мессенджеры.
    fireEvent.click(screen.getByRole('button', { name: SEND }))
    expect(
      await screen.findByText(/никто из участников группы не привязал/),
    ).toBeVisible()
    expect(asked).toEqual([
      { cursor: null, channels: ['telegram', 'vk', 'max'], groupId: id },
      { groupId: id },
    ])

    routes['broadcasts/recipients'] = () => recipients(1, 1)
    routes['broadcasts/send'] = () => ({
      recipients: 2,
      sent: 2,
      failed: 0,
      channels: {
        telegram: { recipients: 1, sent: 1, failed: 0 },
        vk: { recipients: 0, sent: 0, failed: 0 },
        max: { recipients: 1, sent: 1, failed: 0 },
      },
    })
    fireEvent.click(screen.getByRole('button', { name: SEND }))
    const dialog = await screen.findByRole('alertdialog')
    expect(
      within(dialog).getByText(/только участникам группы, текстом без кнопок/),
    ).toBeVisible()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отправить' }))
    await waitFor(() =>
      expect(callApi).toHaveBeenLastCalledWith('broadcasts/send', {
        subject: 'Рейд — Пати 1',
        body: 'Группа «Пати 1»',
        eventId: null,
        groupId: id,
        channels: ['telegram', 'vk', 'max'],
      }),
    )
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        'Отправлено — Telegram: 1, ВКонтакте: 0, MAX: 1',
      ),
    )
  })

  it('sends a vote announcement with its source id for the vote image', async () => {
    const id = '00000000-0000-4000-8000-000000000003'
    routes['broadcasts/prefill'] = () => ({
      subject: 'Голосование: название',
      body: 'Выберите ответ кнопкой ниже или на сайте.',
      recipients: null,
      bodyLimit: 3500,
    })
    routes['broadcasts/recipients'] = () => recipients(1, 1)
    routes['broadcasts/send'] = () => ({
      recipients: 2,
      sent: 2,
      failed: 0,
      channels: {
        telegram: { recipients: 1, sent: 1, failed: 0 },
        vk: { recipients: 0, sent: 0, failed: 0 },
        max: { recipients: 1, sent: 1, failed: 0 },
      },
    })
    await renderApp({
      role: 'officer',
      path: `/broadcast?source=vote&id=${id}`,
    })
    expect(
      await screen.findByText(/учитывает варианты голосования/),
    ).toBeVisible()
    expect(
      screen.getByText(/кнопкой в мессенджере или открыть голосование/),
    ).toBeVisible()
    fireEvent.click(await screen.findByRole('button', { name: SEND }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/кнопками вариантов ответа/)).toBeVisible()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отправить' }))
    await waitFor(() =>
      expect(callApi).toHaveBeenCalledWith('broadcasts/send', {
        subject: 'Голосование: название',
        body: 'Выберите ответ кнопкой ниже или на сайте.',
        eventId: null,
        groupId: null,
        voteId: id,
        channels: ['telegram', 'vk', 'max'],
      }),
    )
  })

  it('adjusts the vote body limit when the author lengthens the subject', async () => {
    const id = '00000000-0000-4000-8000-000000000003'
    routes['broadcasts/prefill'] = () => ({
      subject: 'Голосование: название',
      body: 'Выберите ответ кнопкой ниже или на сайте.',
      recipients: null,
      bodyLimit: 3500,
    })
    await renderApp({
      role: 'officer',
      path: `/broadcast?source=vote&id=${id}`,
    })
    fireEvent.change(await screen.findByLabelText('Тема (необязательно)'), {
      target: { value: 'С'.repeat(120) },
    })
    fireEvent.change(screen.getByLabelText('Текст рассылки'), {
      target: { value: 'Б'.repeat(3450) },
    })
    fireEvent.click(screen.getByRole('button', { name: SEND }))
    expect(await screen.findByText('Слишком длинное значение')).toBeVisible()
    expect(callApi).not.toHaveBeenCalledWith(
      'broadcasts/send',
      expect.anything(),
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
