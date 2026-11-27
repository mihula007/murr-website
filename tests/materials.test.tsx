import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MaterialListResponse } from '@contracts/materials'
import type { MaterialView } from '@/features/content/materials-api'
import { AppError } from '@/lib/errors'
import { renderApp } from './support/render-app'

const callApi = vi.hoisted(() =>
  vi.fn<(route: string, body?: unknown) => Promise<unknown>>(),
)

vi.mock('@/lib/supabase/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  callApi,
}))

vi.mock('@/features/discussions/discussion-thread', () => ({
  DiscussionThread: () => <p>Обсуждение открыто</p>,
}))

const ID = '33333333-3333-4333-8333-333333333333'

function material(extra: Partial<MaterialView> = {}): MaterialView {
  return {
    id: ID,
    category: 'guide',
    title: 'Гайд по осаде',
    summary: null,
    excerpt: 'Сбор у портала',
    coverUrl: null,
    status: 'published',
    updatedAt: '2026-11-12T10:00:00Z',
    author: { state: 'shown', gameNickname: 'Офицер' },
    discussionEnabled: false,
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Сбор у портала' }],
        },
      ],
    },
    createdAt: '2026-11-12T10:00:00Z',
    publishedAt: '2026-11-12T10:00:00Z',
    canManage: false,
    showAuthor: true,
    attachments: [],
    ...extra,
  }
}

function list(
  items: MaterialView[],
  extra: Partial<MaterialListResponse<string>> = {},
): MaterialListResponse<string> {
  return {
    items,
    page: 1,
    pageCount: 1,
    total: items.length,
    truncated: false,
    canCreate: false,
    ...extra,
  }
}

function respond(routes: Record<string, (body: unknown) => unknown>) {
  callApi.mockImplementation((route, body) => {
    const handler = routes[route]
    return handler
      ? Promise.resolve(handler(body))
      : Promise.reject(new AppError('not_found'))
  })
}

beforeEach(() => {
  callApi.mockReset()
})

describe('publications feed (PUB-01, PUB-09, Q-55)', () => {
  it('shows cards to a member without drafts or a create button', async () => {
    respond({ 'publications/list': () => list([material()], { pageCount: 3 }) })
    await renderApp({ role: 'member', path: '/publications' })
    expect(
      await screen.findByRole('link', { name: 'Гайд по осаде' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Автор: Офицер')).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Черновики' })).toBeNull()
    expect(screen.queryByRole('link', { name: /Новая публикация/ })).toBeNull()
    expect(
      screen.getByRole('navigation', { name: 'Страницы' }),
    ).toBeInTheDocument()
  })

  it('sends the search and the page to the server and shows the empty result', async () => {
    respond({ 'publications/list': () => list([]) })
    await renderApp({ role: 'member', path: '/publications?page=2&q=устав' })
    expect(await screen.findByText('Ничего не найдено')).toBeInTheDocument()
    expect(callApi).toHaveBeenCalledWith('publications/list', {
      tab: 'published',
      page: 2,
      category: null,
      search: 'устав',
    })
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Сбросить поиск' })[0]!,
    )
    await waitFor(() =>
      expect(callApi).toHaveBeenLastCalledWith('publications/list', {
        tab: 'published',
        page: 1,
        category: null,
        search: null,
      }),
    )
  })

  it('filters drafts on the client and reports truncation', async () => {
    respond({
      'publications/list': (body) =>
        (body as { tab: string }).tab === 'drafts'
          ? list(
              [
                material({ status: 'draft', title: 'Черновик устава' }),
                material({
                  id: `${ID.slice(0, -1)}4`,
                  status: 'draft',
                  title: 'Другое',
                }),
              ],
              { truncated: true, canCreate: true },
            )
          : list([], { canCreate: true }),
    })
    await renderApp({
      role: 'officer',
      path: '/publications?tab=drafts&q=устав',
    })
    expect(
      await screen.findByRole('link', { name: 'Черновик устава' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Другое' })).toBeNull()
    expect(
      screen.getByText(/Показаны 50 последних черновиков/),
    ).toBeInTheDocument()
    expect(callApi).toHaveBeenCalledWith('publications/list', { tab: 'drafts' })
  })
})

describe('material page (PUB-06, PUB-07)', () => {
  it('hides management from a reader', async () => {
    respond({ 'publications/get': () => material() })
    await renderApp({ role: 'member', path: `/publications/${ID}` })
    expect(
      await screen.findByRole('heading', { name: 'Гайд по осаде' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Редактировать/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Удалить' })).toBeNull()
  })

  it('lets the author unpublish after confirmation', async () => {
    respond({
      'publications/get': () => material({ canManage: true }),
      'publications/unpublish': () =>
        material({ canManage: true, status: 'draft' }),
    })
    await renderApp({ role: 'officer', path: `/publications/${ID}` })
    fireEvent.click(
      await screen.findByRole('button', { name: 'Снять с публикации' }),
    )
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Снять с публикации' }),
    )
    await waitFor(() =>
      expect(callApi).toHaveBeenCalledWith('publications/unpublish', {
        id: ID,
      }),
    )
  })

  it('shows «Пользователь удалён» for a deleted author (PUB-17)', async () => {
    respond({
      'market/get': () =>
        material({ author: { state: 'deleted' }, category: 'sale' }),
    })
    await renderApp({ role: 'member', path: `/market/${ID}` })
    expect(await screen.findByText('Пользователь удалён')).toBeInTheDocument()
    expect(screen.getByText('Продажа')).toBeInTheDocument()
  })
})

describe('market listing discussion (MKT-10)', () => {
  it('shows an enabled discussion expanded below the listing', async () => {
    respond({
      'market/get': () =>
        material({
          category: 'buy',
          title: 'Куплю хэви чара',
          discussionEnabled: true,
          messageCount: 1,
        }),
    })

    await renderApp({ role: 'member', path: `/market/${ID}` })

    expect(await screen.findByText('Обсуждение открыто')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Обсуждение \(1\)/ }),
    ).toBeNull()
  })
})

describe('material editor', () => {
  it('rejects an empty material before calling the server (PUB-03)', async () => {
    respond({})
    await renderApp({ role: 'officer', path: '/publications/new' })
    fireEvent.change(await screen.findByLabelText('Заголовок'), {
      target: { value: 'Пусто' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить черновик' }))
    expect(
      await screen.findByText('Добавьте текст, изображение или таблицу'),
    ).toBeInTheDocument()
    expect(callApi).not.toHaveBeenCalledWith(
      'publications/save',
      expect.anything(),
    )
  })

  it('does not submit the material from the link dialog', async () => {
    respond({})
    await renderApp({ role: 'officer', path: '/publications/new' })
    fireEvent.click(
      await screen.findByRole('button', { name: 'Видео YouTube или VK' }),
    )
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Ссылка на видео'), {
      target: { value: 'https://rutube.ru/video/x' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Вставить' }))
    expect(
      await within(dialog).findByText('Это не ссылка на ролик YouTube или VK.'),
    ).toBeInTheDocument()
    expect(callApi).not.toHaveBeenCalledWith(
      'publications/save',
      expect.anything(),
    )
  })

  it('has no attachments or signature toggle in the market editor (MKT-03, MKT-08)', async () => {
    respond({})
    await renderApp({ role: 'member', path: '/market/new' })
    expect(await screen.findByLabelText('Заголовок')).toBeInTheDocument()
    expect(screen.queryByText('Вложения')).toBeNull()
    expect(screen.queryByText('Показывать читателям подпись автора')).toBeNull()
  })

  it('shows arena when creating a market listing (MKT-02)', async () => {
    respond({})
    await renderApp({ role: 'member', path: '/market/new' })
    const createCategory = await screen.findByRole('combobox', {
      name: 'Категория',
    })
    expect(createCategory).toHaveTextContent('Продажа')
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn<() => void>(),
    })
    fireEvent.click(createCategory)
    expect(screen.getByRole('option', { name: 'Арена' })).toBeInTheDocument()
  })

  it('shows arena when editing a market listing (MKT-02)', async () => {
    respond({
      'market/get': () =>
        material({
          category: 'arena',
          title: 'Группа на арену',
          canManage: true,
        }),
    })
    await renderApp({ role: 'member', path: `/market/${ID}/edit` })
    expect(
      await screen.findByRole('combobox', { name: 'Категория' }),
    ).toHaveTextContent('Арена')
  })

  it('filters and searches market listings by arena (MKT-02)', async () => {
    respond({
      'market/list': () =>
        list([material({ category: 'arena', title: 'Набор на арену' })]),
    })
    await renderApp({ role: 'member', path: '/market?category=arena&q=арена' })
    expect(
      await screen.findByRole('link', { name: 'Набор на арену' }),
    ).toBeInTheDocument()
    expect(screen.getAllByText('Арена').length).toBeGreaterThan(0)
    expect(callApi).toHaveBeenCalledWith('market/list', {
      tab: 'published',
      page: 1,
      category: 'arena',
      search: 'арена',
    })
  })
})
