import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApplicationDetails } from '@contracts/applications'
import type { VoteDetails, VoteListResponse } from '@contracts/votes'
import { AppError } from '@/lib/errors'
import { dataCalls } from './support/api-calls'
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
const APPLICATION_ID = '11111111-1111-4111-8111-111111111111'
const YES = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const NO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'

function vote(extra: Partial<VoteDetails> = {}): VoteDetails {
  return {
    id: VOTE_ID,
    kind: 'general',
    title: 'Куда идём в субботу?',
    context: 'Выбираем подземелье',
    createdAt: '2026-11-10T10:00:00Z',
    closedAt: null,
    createdBy: { gameNickname: 'Офицер' },
    applicant: null,
    options: [
      { id: YES, label: 'Башня', count: 2, leading: true },
      { id: NO, label: 'Пещера', count: 1, leading: false },
    ],
    totalBallots: 3,
    myOptionId: null,
    ...extra,
  }
}

function list(items: VoteDetails[], extra: Partial<VoteListResponse> = {}) {
  return {
    items,
    nextCursor: null,
    activeCount: items.length,
    truncated: false,
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

describe('votes list (VOT-01)', () => {
  it('shows active votes with results and the leader to a member', async () => {
    respond({ 'votes/list': () => list([vote()]) })
    await renderApp({ role: 'member', path: '/votes' })
    const card = within(
      await screen.findByRole('list', { name: 'Актуальные голосования' }),
    )
    expect(card.getByText('Куда идём в субботу?')).toBeVisible()
    expect(card.getByText('Выбираем подземелье')).toBeVisible()
    expect(card.getByLabelText('Лидирует')).toBeVisible()
    expect(card.getByLabelText('Башня: 2 из 3')).toBeVisible()
    // Член клана не создаёт и не управляет (ACL-04).
    expect(screen.queryByText('Создать голосование')).toBeNull()
    expect(card.queryByRole('button', { name: 'Завершить' })).toBeNull()
  })

  it('offers management to an officer', async () => {
    respond({ 'votes/list': () => list([vote()]) })
    await renderApp({ role: 'officer', path: '/votes' })
    expect(
      await screen.findByRole('link', { name: /Создать голосование/ }),
    ).toBeVisible()
    for (const name of ['Изменить', 'Завершить', 'Удалить']) {
      expect(screen.getByRole('button', { name })).toBeVisible()
    }
  })

  it('shows history without voting or management (VOT-12)', async () => {
    respond({
      'votes/list': (body) =>
        (body as { tab: string }).tab === 'active'
          ? list([])
          : list(
              [
                vote({
                  closedAt: '2026-11-11T10:00:00Z',
                  myOptionId: YES,
                }),
              ],
              { activeCount: 0 },
            ),
    })
    await renderApp({ role: 'admin', path: '/votes?tab=history' })
    expect(await screen.findByText(/Завершено 11\.11\.2026/)).toBeVisible()
    expect(screen.getByText('ваш выбор')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Башня' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Изменить' })).toBeNull()
  })

  it('is closed to applicants and readers', async () => {
    for (const role of ['applicant', 'reader'] as const) {
      const view = await renderApp({ role, path: '/votes' })
      expect(await screen.findByText('Нет доступа')).toBeVisible()
      view.unmount()
    }
    expect(dataCalls(callApi)).toEqual([])
  })
})

describe('ballot (VOT-05, VOT-06)', () => {
  it('casts a vote and keeps the old choice until a new one', async () => {
    let current = vote()
    respond({
      'votes/list': () => list([current]),
      'votes/cast': (body) => {
        const { optionId } = body as { optionId: string }
        current = vote({ myOptionId: optionId })
        return current
      },
    })
    await renderApp({ role: 'member', path: '/votes' })
    fireEvent.click(await screen.findByRole('button', { name: 'Пещера' }))
    await waitFor(() =>
      expect(callApi).toHaveBeenCalledWith('votes/cast', {
        voteId: VOTE_ID,
        optionId: NO,
      }),
    )
    expect(await screen.findByText('Ваше решение:')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Изменить решение' }))
    // Прежний голос в силе, пока не выбран новый.
    fireEvent.click(screen.getByRole('button', { name: 'Оставить «Пещера»' }))
    expect(
      screen.getByRole('button', { name: 'Изменить решение' }),
    ).toBeVisible()
    expect(dataCalls(callApi)).toHaveLength(2)
  })

  it('reports a vote closed meanwhile', async () => {
    respond({
      'votes/list': () => list([vote()]),
      'votes/cast': () => {
        throw new AppError('state_conflict')
      },
    })
    await renderApp({ role: 'member', path: '/votes' })
    fireEvent.click(await screen.findByRole('button', { name: 'Башня' }))
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith('Голосование уже завершено'),
    )
    // Карточки перечитываются: голосование ушло в историю.
    await waitFor(() =>
      expect(
        callApi.mock.calls.filter(([route]) => route === 'votes/list'),
      ).toHaveLength(2),
    )
  })
})

describe('vote page', () => {
  it('shows ballots to an officer and the applicant only by nick and class', async () => {
    respond({
      'votes/get': () =>
        vote({
          kind: 'application',
          title: 'Заявка: Рейна',
          applicant: { gameNickname: 'Рейна', className: 'Маг' },
          applicationId: APPLICATION_ID,
          ballots: [
            { gameNickname: 'Борис', optionId: YES },
            { gameNickname: null, optionId: NO },
          ],
          ballotsTruncated: false,
        }),
    })
    await renderApp({ role: 'officer', path: `/votes/${VOTE_ID}` })
    expect(await screen.findByText('Кандидат: Рейна · Маг')).toBeVisible()
    const ballots = within(
      screen.getByRole('list', { name: 'Голоса участников' }),
    )
    expect(ballots.getByText('Борис')).toBeVisible()
    expect(ballots.getByText('Пользователь удалён')).toBeVisible()
    expect(
      screen.getByRole('link', { name: 'Открыть заявку кандидата' }),
    ).toBeVisible()
  })

  it('shows a member no ballots', async () => {
    respond({ 'votes/get': () => vote() })
    await renderApp({ role: 'member', path: `/votes/${VOTE_ID}` })
    expect(await screen.findByText('Куда идём в субботу?')).toBeVisible()
    expect(screen.queryByText('Кто как голосовал')).toBeNull()
  })

  it('closes after confirmation', async () => {
    respond({
      'votes/get': () => vote(),
      'votes/close': () => vote({ closedAt: '2026-11-11T12:00:00Z' }),
      'votes/list': () => list([]),
    })
    await renderApp({ role: 'officer', path: `/votes/${VOTE_ID}` })
    fireEvent.click(await screen.findByRole('button', { name: 'Завершить' }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Завершить' }))
    await waitFor(() =>
      expect(callApi).toHaveBeenCalledWith('votes/close', { id: VOTE_ID }),
    )
    expect(
      await screen.findByText(
        'Голосование завершено: решение изменить нельзя.',
      ),
    ).toBeVisible()
  })
})

describe('create vote (VOT-02, VOT-03)', () => {
  it('limits options to 2–10 and rejects duplicates before the server', async () => {
    await renderApp({ role: 'officer', path: '/votes/new' })
    const form = within(
      await screen.findByRole('form', { name: 'Новое голосование' }),
    )
    expect(
      form.getByRole('button', { name: 'Удалить вариант 1' }),
    ).toBeDisabled()
    for (let n = 0; n < 8; n += 1) {
      fireEvent.click(form.getByRole('button', { name: /Добавить вариант/ }))
    }
    expect(form.queryByRole('button', { name: /Добавить вариант/ })).toBeNull()
    for (let n = 10; n > 2; n -= 1) {
      fireEvent.click(
        form.getByRole('button', { name: `Удалить вариант ${n}` }),
      )
    }

    fireEvent.change(form.getByLabelText('Тема'), {
      target: { value: 'Тема' },
    })
    fireEvent.change(form.getByLabelText('Вариант 1'), {
      target: { value: 'Да' },
    })
    fireEvent.change(form.getByLabelText('Вариант 2'), {
      target: { value: ' да ' },
    })
    fireEvent.click(form.getByRole('button', { name: 'Создать голосование' }))
    expect(await form.findByText('Такое значение уже есть')).toBeVisible()
    expect(dataCalls(callApi)).toEqual([])
  })

  it('creates a vote and opens it', async () => {
    respond({
      'votes/create': () => vote({ title: 'Тема', context: '' }),
      'votes/get': () => vote({ title: 'Тема', context: '' }),
      'votes/list': () => list([]),
    })
    await renderApp({ role: 'admin', path: '/votes/new' })
    const form = within(
      await screen.findByRole('form', { name: 'Новое голосование' }),
    )
    fireEvent.change(form.getByLabelText('Тема'), {
      target: { value: 'Тема' },
    })
    fireEvent.change(form.getByLabelText('Вариант 1'), {
      target: { value: 'Башня' },
    })
    fireEvent.change(form.getByLabelText('Вариант 2'), {
      target: { value: 'Пещера' },
    })
    fireEvent.click(form.getByRole('button', { name: 'Создать голосование' }))
    await waitFor(() =>
      expect(callApi).toHaveBeenCalledWith('votes/create', {
        title: 'Тема',
        context: '',
        options: ['Башня', 'Пещера'],
      }),
    )
    expect(
      await screen.findByRole('link', { name: /К голосованиям/ }),
    ).toBeVisible()
  })

  it('is closed to members', async () => {
    await renderApp({ role: 'member', path: '/votes/new' })
    expect(await screen.findByText('Нет доступа')).toBeVisible()
  })
})

function application(extra: Partial<ApplicationDetails> = {}) {
  return {
    id: APPLICATION_ID,
    status: 'pending_officer_review',
    submittedAt: '2026-11-10T10:00:00Z',
    decidedAt: null,
    decisionNote: null,
    decidedBy: null,
    equipmentLinks: [],
    applicant: {
      id: 'u2',
      displayName: 'Анна',
      gameNickname: 'Рейна',
      classId: 7,
      className: 'Маг',
      avatarUrl: null,
      about: 'Играю давно',
    },
    ...extra,
  } satisfies ApplicationDetails
}

const VOTE_RESULT = {
  id: VOTE_ID,
  closedAt: '2026-11-11T10:00:00Z',
  totalBallots: 2,
  options: [
    { id: YES, label: 'За', count: 2, leading: true },
    { id: NO, label: 'Против', count: 0, leading: false },
  ],
}

describe('application voting (APP-04, APP-05, APP-08)', () => {
  it('submits a new application to a vote after confirmation', async () => {
    respond({
      'applications/get': () => application(),
      'applications/submit-to-vote': () =>
        application({
          status: 'pending_vote',
          vote: { ...VOTE_RESULT, closedAt: null },
        }),
      'applications/list': () => ({
        items: [],
        nextCursor: null,
        newCount: 0,
        truncated: false,
      }),
      'votes/list': () => list([]),
    })
    await renderApp({
      role: 'officer',
      path: `/applications/${APPLICATION_ID}`,
    })
    fireEvent.click(
      await screen.findByRole('button', { name: 'Передать на голосование' }),
    )
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Передать' }))
    await waitFor(() =>
      expect(callApi).toHaveBeenCalledWith('applications/submit-to-vote', {
        id: APPLICATION_ID,
      }),
    )
    expect(
      await screen.findByRole('link', { name: 'Открыть голосование' }),
    ).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Принять' })).toBeNull()
  })

  it('lets only the admin decide after the vote', async () => {
    respond({
      'applications/get': () =>
        application({ status: 'vote_completed', vote: VOTE_RESULT }),
      'applications/final-decide': () =>
        application({
          status: 'admin_approved',
          decidedAt: '2026-11-11T12:00:00Z',
          vote: VOTE_RESULT,
        }),
      'applications/list': () => ({
        items: [],
        nextCursor: null,
        newCount: 0,
        finalCount: 0,
        truncated: false,
      }),
    })
    const officer = await renderApp({
      role: 'officer',
      path: `/applications/${APPLICATION_ID}`,
    })
    expect(
      await screen.findByText(/Окончательное решение принимает администратор/),
    ).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Принять' })).toBeNull()
    officer.unmount()

    await renderApp({ role: 'admin', path: `/applications/${APPLICATION_ID}` })
    fireEvent.click(await screen.findByRole('button', { name: 'Принять' }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Принять' }))
    await waitFor(() =>
      expect(callApi).toHaveBeenCalledWith('applications/final-decide', {
        id: APPLICATION_ID,
        decision: 'accept',
        note: null,
      }),
    )
    expect(
      await screen.findByText('Администрация подтвердила приём'),
    ).toBeVisible()
  })

  it('shows the final-decision tab only to the admin', async () => {
    respond({
      'applications/list': (body) => ({
        items:
          (body as { tab: string }).tab === 'final'
            ? [
                {
                  id: APPLICATION_ID,
                  status: 'vote_completed',
                  submittedAt: '2026-11-10T10:00:00Z',
                  decidedAt: null,
                  applicant: application().applicant,
                  vote: VOTE_RESULT,
                },
              ]
            : [],
        nextCursor: null,
        newCount: 0,
        finalCount: 1,
        truncated: false,
      }),
    })
    const officer = await renderApp({
      role: 'officer',
      path: '/applications?tab=final',
    })
    expect(await screen.findByText('Новых заявок нет')).toBeVisible()
    expect(screen.queryByRole('tab', { name: /Окончательные/ })).toBeNull()
    officer.unmount()

    await renderApp({ role: 'admin', path: '/applications?tab=final' })
    const queue = within(
      await screen.findByRole('list', { name: 'Окончательные решения' }),
    )
    expect(queue.getByText('За: 2 · Против: 0')).toBeVisible()
  })
})
