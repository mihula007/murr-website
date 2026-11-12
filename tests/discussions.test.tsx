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
import {
  editableUntil,
  mentionCandidates,
  type DiscussionMessage,
  type DiscussionPage,
} from '@contracts/discussions'
import type { VoteDetails } from '@contracts/votes'
import { insertAt } from '@/features/discussions/composer'
import { withDateLabels } from '@/features/discussions/discussion-thread'
import { isSubmitShortcut } from '@/features/discussions/message'
import { splitMentions } from '@/features/discussions/message-text'
import {
  mergeMessages,
  threadMessages,
  type ThreadData,
} from '@/features/discussions/thread-cache'
import { AppError } from '@/lib/errors'
import { renderApp } from './support/render-app'

const callApi = vi.hoisted(() =>
  vi.fn<(route: string, body?: unknown) => Promise<unknown>>(),
)
const toast = vi.hoisted(() => vi.fn<(message: string) => void>())

vi.mock('@/components/ui/toaster', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast,
}))
vi.mock('@/lib/supabase/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  callApi,
}))

const VOTE_ID = '22222222-2222-4222-8222-222222222222'

function message(
  id: string,
  extra: Partial<DiscussionMessage> = {},
): DiscussionMessage {
  return {
    id,
    author: {
      state: 'shown',
      id: 'author-1',
      gameNickname: 'Ворон',
      avatarUrl: null,
      badge: null,
    },
    mine: false,
    body: `Сообщение ${id}`,
    createdAt: '2026-11-12T09:00:00.000Z',
    editedAt: null,
    changedAt: '2026-11-12T09:00:00.000Z',
    replyTo: null,
    reactions: [],
    ...extra,
  }
}

function page(
  items: DiscussionMessage[],
  extra: Partial<DiscussionPage> = {},
): DiscussionPage {
  return {
    items,
    nextCursor: null,
    canWrite: true,
    othersReadUpTo: null,
    now: '2026-11-12T09:01:00.000Z',
    ...extra,
  }
}

function vote(extra: Partial<VoteDetails> = {}): VoteDetails {
  return {
    id: VOTE_ID,
    kind: 'general',
    title: 'Куда идём?',
    context: '',
    createdAt: '2026-11-10T10:00:00Z',
    closedAt: null,
    createdBy: { gameNickname: 'Офицер' },
    applicant: null,
    options: [],
    totalBallots: 0,
    myOptionId: null,
    messageCount: 2,
    ...extra,
  }
}

function respond(routes: Record<string, (body: unknown) => unknown>) {
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
}

beforeEach(() => {
  callApi.mockReset()
  toast.mockReset()
})

// В jsdom у элементов нет размеров: ленте в блоке нужна высота, чтобы
// виртуализатор (он читает clientHeight блока) отрисовал строки.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => 600,
  })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 400,
  })
})
afterAll(() => {
  Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight')
  Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth')
})

describe('discussion helpers', () => {
  it('finds mention candidates without trailing punctuation', () => {
    expect(mentionCandidates('Привет, @Ворон! и @lynx: e@mail')).toEqual([
      'ворон!',
      'ворон',
      'lynx:',
      'lynx',
    ])
  })

  it('splits text into plain parts and mentions', () => {
    expect(splitMentions('Зову @Ворон и e@mail')).toEqual([
      { text: 'Зову ', mention: false },
      { text: '@Ворон', mention: true },
      { text: ' и e@mail', mention: false },
    ])
  })

  it('inserts an emoji at the cursor', () => {
    expect(insertAt('Привет мир', '🔥', 6, 6)).toEqual({
      value: 'Привет🔥 мир',
      caret: 8,
    })
    expect(insertAt('Текст', '👍', null, null).value).toBe('Текст👍')
  })

  it('submits on Ctrl+Enter and Cmd+Enter only', () => {
    expect(
      isSubmitShortcut({ key: 'Enter', ctrlKey: true, metaKey: false }),
    ).toBe(true)
    expect(
      isSubmitShortcut({ key: 'Enter', ctrlKey: false, metaKey: true }),
    ).toBe(true)
    expect(
      isSubmitShortcut({ key: 'Enter', ctrlKey: false, metaKey: false }),
    ).toBe(false)
  })

  it('opens the edit window for five minutes', () => {
    expect(editableUntil('2026-11-12T09:00:00.000Z')).toBe(
      '2026-11-12T09:05:00.000Z',
    )
  })

  it('labels the first message of each Moscow day', () => {
    const labels = withDateLabels([
      message('a', { createdAt: '2026-11-11T20:00:00.000Z' }),
      message('b', { createdAt: '2026-11-11T21:30:00.000Z' }),
      message('c', { createdAt: '2026-11-11T22:00:00.000Z' }),
    ]).map((item) => item.dateLabel)
    // 21:30 UTC — уже 12.11 по Москве.
    expect(labels).toEqual(['11.11.2026', '12.11.2026', null])
  })

  it('merges polled messages into loaded pages', () => {
    const data: ThreadData = {
      pages: [page([message('b'), message('a')]), page([message('old')])],
      pageParams: [null, 'cursor'],
    }
    const edited = message('a', {
      body: 'Исправлено',
      changedAt: '2026-11-12T09:02:00.000Z',
    })
    const stale = message('old', {
      body: 'Устарело',
      changedAt: '2026-11-11T00:00:00.000Z',
    })
    const fresh = message('c', { createdAt: '2026-11-12T09:03:00.000Z' })
    const merged = mergeMessages(data, [edited, stale, fresh], {
      canWrite: false,
      othersReadUpTo: '2026-11-12T09:03:00.000Z',
      now: '2026-11-12T09:04:00.000Z',
    })
    expect(threadMessages(merged).map((m) => m.body)).toEqual([
      'Сообщение old',
      'Исправлено',
      'Сообщение b',
      'Сообщение c',
    ])
    expect(merged?.pages[0]).toMatchObject({
      canWrite: false,
      now: '2026-11-12T09:04:00.000Z',
    })
  })
})

describe('discussion dialog (DSC)', () => {
  async function openDiscussion(
    thread: DiscussionPage,
    routes: Record<string, (body: unknown) => unknown> = {},
  ) {
    respond({
      'votes/get': () => vote(),
      'discussions/list': () => thread,
      'discussions/changes': () => ({ ...thread, items: [], reset: false }),
      'discussions/mark-read': () => ({ readUpTo: null }),
      ...routes,
    })
    await renderApp({ role: 'member', path: `/votes/${VOTE_ID}` })
    const button = await screen.findByRole('button', {
      name: 'Обсуждение (2)',
    })
    fireEvent.click(button)
    return { button, dialog: await screen.findByRole('dialog') }
  }

  it('shows messages, reply quote, own read state and sends with Ctrl+Enter', async () => {
    const mine = message('m', {
      mine: true,
      author: {
        state: 'shown',
        id: 'me',
        gameNickname: 'Я',
        avatarUrl: null,
        badge: null,
      },
      createdAt: '2026-11-12T08:00:00.000Z',
    })
    const officer = message('o', {
      author: {
        state: 'shown',
        id: 'officer',
        gameNickname: 'Кречет',
        avatarUrl: null,
        badge: 'officer',
      },
      body: '<b>не html</b> @Я',
      replyTo: { id: 'm', gameNickname: 'Я', excerpt: 'Исходный текст' },
      reactions: [{ emoji: '👍', count: 2, mine: true }],
    })
    let sent: unknown = null
    const { dialog } = await openDiscussion(
      page([officer, mine], { othersReadUpTo: '2026-11-12T08:30:00.000Z' }),
      {
        'discussions/send': (body) => {
          sent = body
          return message('new', { mine: true, body: 'Привет' })
        },
      },
    )
    const panel = within(dialog)
    expect(
      await panel.findByText('<b>не html</b>', { exact: false }),
    ).toBeTruthy()
    expect(panel.getByText('@Я')).toBeTruthy()
    expect(panel.getByText('Офицер')).toBeTruthy()
    expect(panel.getByText('Исходный текст')).toBeTruthy()
    expect(panel.getByText('Прочитано')).toBeTruthy()
    expect(
      panel.getByRole('button', { name: '👍 2' }).getAttribute('aria-pressed'),
    ).toBe('true')

    const field = panel.getByLabelText('Сообщение')
    fireEvent.change(field, { target: { value: '  Привет  ' } })
    fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true })
    await waitFor(() =>
      expect(sent).toEqual({
        parent: 'vote',
        parentId: VOTE_ID,
        body: 'Привет',
        replyToId: null,
      }),
    )
    await waitFor(() => expect((field as HTMLTextAreaElement).value).toBe(''))
  })

  it('replies from the message menu, cancels the reply and reacts', async () => {
    const recent = message('r', {
      mine: true,
      createdAt: '2026-11-12T09:00:30.000Z',
    })
    const other = message('o', {
      author: {
        state: 'shown',
        id: 'officer',
        gameNickname: 'Кречет',
        avatarUrl: null,
        badge: null,
      },
    })
    let reacted: unknown = null
    const { dialog } = await openDiscussion(page([recent, other]), {
      'discussions/react': (body) => {
        reacted = body
        return { ...other, reactions: [{ emoji: '🤡', count: 1, mine: true }] }
      },
    })
    const panel = within(dialog)
    const trigger = await panel.findByRole('button', {
      name: 'Действия с сообщением Кречет',
    })
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(screen.queryByRole('menuitem', { name: 'Изменить' })).toBeNull()
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Ответить' }))
    expect(await panel.findByText('Ответ Кречет')).toBeTruthy()
    fireEvent.click(panel.getByRole('button', { name: 'Отменить ответ' }))
    expect(panel.queryByText('Ответ Кречет')).toBeNull()

    fireEvent.keyDown(trigger, { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Реакция 🤡' }))
    await waitFor(() =>
      expect(reacted).toEqual({ messageId: 'o', emoji: '🤡' }),
    )
    expect(await panel.findByRole('button', { name: '🤡 1' })).toBeTruthy()

    const mine = panel.getByRole('button', {
      name: 'Действия с сообщением Ворон',
    })
    fireEvent.keyDown(mine, { key: 'Enter' })
    expect(
      await screen.findByRole('menuitem', { name: 'Изменить' }),
    ).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Кто прочитал' })).toBeTruthy()
  })

  it('does not send an empty message', async () => {
    const { dialog } = await openDiscussion(page([]))
    const panel = within(dialog)
    expect(await panel.findByText('Сообщений пока нет.')).toBeTruthy()
    fireEvent.click(panel.getByRole('button', { name: 'Отправить' }))
    expect(await panel.findByText('Заполните поле')).toBeTruthy()
    expect(callApi).not.toHaveBeenCalledWith(
      'discussions/send',
      expect.anything(),
    )
  })

  it('keeps a closed thread read-only', async () => {
    const { dialog } = await openDiscussion(
      page([message('a')], { canWrite: false }),
    )
    const panel = within(dialog)
    expect(
      await panel.findByText(
        'Обсуждение закрыто: история доступна для чтения.',
      ),
    ).toBeTruthy()
    expect(panel.queryByLabelText('Сообщение')).toBeNull()
  })

  it('closes with Escape and returns focus to the button', async () => {
    const { button } = await openDiscussion(page([message('a')]))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(button))
  })
})
