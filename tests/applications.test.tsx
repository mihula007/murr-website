import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApplicationStatus } from '@contracts/account'
import type { ApplicationDetails } from '@contracts/applications'
import { ApplicantPath } from '@/features/applications/applicant-path'
import { AppError } from '@/lib/errors'
import { renderApp } from './support/render-app'
import { renderWithRouter } from './support/render-with-router'

const me = vi.hoisted(() => ({ value: {} as unknown }))
const callApi = vi.hoisted(() =>
  vi.fn<(route: string, body?: unknown) => Promise<unknown>>(),
)

vi.mock('@/features/account/use-me', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useMe: () => ({
    data: me.value,
    isPending: false,
    isError: false,
    refetch: vi.fn<() => void>(),
  }),
}))
vi.mock('@/lib/supabase/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  callApi,
}))

const APPLICATION_ID = '11111111-1111-4111-8111-111111111111'

function details(extra: Partial<ApplicationDetails> = {}): ApplicationDetails {
  return {
    id: APPLICATION_ID,
    status: 'pending_officer_review',
    submittedAt: '2026-11-10T10:00:00Z',
    decidedAt: null,
    decisionNote: null,
    decidedBy: null,
    equipmentLinks: ['https://example.com/gear.png'],
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
  }
}

const CONTACTS = {
  email: 'anna@example.com',
  city: 'Казань',
  birthDate: '1995-04-12',
}

function respond(routes: Record<string, (body: unknown) => unknown>) {
  callApi.mockImplementation((route, body) => {
    const handler = routes[route]
    if (!handler) return Promise.reject(new AppError('not_found'))
    try {
      return Promise.resolve(handler(body))
    } catch (error) {
      return Promise.reject(error)
    }
  })
}

beforeEach(() => {
  callApi.mockReset()
  me.value = {}
})

describe('application queue', () => {
  it('lists new applications with the counter and opens a card', async () => {
    respond({
      'applications/list': () => ({
        items: [
          {
            id: APPLICATION_ID,
            status: 'pending_officer_review',
            submittedAt: '2026-11-10T10:00:00Z',
            decidedAt: null,
            applicant: details().applicant,
          },
        ],
        page: 0,
        hasMore: false,
        newCount: 1,
      }),
    })
    await renderApp({ role: 'officer', path: '/applications' })
    const card = await screen.findByRole('link', { name: /Рейна/ })
    expect(card).toHaveTextContent('Маг · подана 10.11.2026')
    expect(card).toHaveAttribute('href', `/applications/${APPLICATION_ID}`)
    expect(
      within(screen.getByRole('tab', { name: /Новые/ })).getByText('1'),
    ).toBeVisible()
    expect(callApi).toHaveBeenCalledWith('applications/list', {
      tab: 'new',
      page: 0,
    })
  })

  it('shows an empty state for the decided tab', async () => {
    respond({
      'applications/list': () => ({
        items: [],
        page: 0,
        hasMore: false,
        newCount: 0,
      }),
    })
    await renderApp({ role: 'admin', path: '/applications?tab=decided' })
    expect(await screen.findByText('Решённых заявок нет')).toBeVisible()
  })

  it('is closed to members', async () => {
    await renderApp({ role: 'member', path: '/applications' })
    expect(await screen.findByText('Нет доступа')).toBeVisible()
    expect(callApi).not.toHaveBeenCalledWith(
      'applications/list',
      expect.anything(),
    )
  })
})

describe('application card', () => {
  it('shows an officer no personal contacts (APP-03)', async () => {
    respond({ 'applications/get': () => details() })
    await renderApp({
      role: 'officer',
      path: `/applications/${APPLICATION_ID}`,
    })
    expect(await screen.findByText('Играю давно')).toBeVisible()
    expect(screen.getByText('Анна')).toBeVisible()
    expect(screen.queryByText('Личные данные')).not.toBeInTheDocument()
    expect(screen.queryByText('anna@example.com')).not.toBeInTheDocument()
    const link = screen.getByRole('link', {
      name: /https:\/\/example\.com\/gear\.png/,
    })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('shows an admin email, city and birth date', async () => {
    respond({ 'applications/get': () => details({ contacts: CONTACTS }) })
    await renderApp({ role: 'admin', path: `/applications/${APPLICATION_ID}` })
    expect(await screen.findByText('Личные данные')).toBeVisible()
    expect(screen.getByText('anna@example.com')).toBeVisible()
    expect(screen.getByText('Казань')).toBeVisible()
    expect(screen.getByText('12.04.1995')).toBeVisible()
  })

  it('accepts after confirmation with an optional note', async () => {
    respond({
      'applications/get': () => details(),
      'applications/decide': () =>
        details({
          status: 'officer_approved',
          decidedAt: '2026-11-11T09:00:00Z',
          decidedBy: { gameNickname: 'Офицер' },
          decisionNote: 'Хороший игрок',
        }),
      'applications/list': () => ({
        items: [],
        page: 0,
        hasMore: false,
        newCount: 0,
      }),
    })
    await renderApp({
      role: 'officer',
      path: `/applications/${APPLICATION_ID}`,
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Принять' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Принять Рейна в клан?')).toBeVisible()
    expect(callApi).not.toHaveBeenCalledWith(
      'applications/decide',
      expect.anything(),
    )
    fireEvent.change(within(dialog).getByLabelText('Примечание'), {
      target: { value: 'Хороший игрок' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Принять' }))

    await waitFor(() =>
      expect(callApi).toHaveBeenCalledWith('applications/decide', {
        id: APPLICATION_ID,
        decision: 'accept',
        note: 'Хороший игрок',
      }),
    )
    expect(
      await screen.findByText('Заявка подтверждена офицером'),
    ).toBeVisible()
    expect(screen.getByText('Хороший игрок')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Принять' })).toBeNull()
  })

  it('rejects without a note and closes the dialog on cancel', async () => {
    respond({
      'applications/get': () => details(),
      'applications/decide': () =>
        details({ status: 'officer_rejected', decidedAt: '2026-11-11' }),
    })
    await renderApp({
      role: 'officer',
      path: `/applications/${APPLICATION_ID}`,
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Отклонить' }))
    let dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: 'Отклонить' }))
    dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отклонить' }))
    await waitFor(() =>
      expect(callApi).toHaveBeenCalledWith('applications/decide', {
        id: APPLICATION_ID,
        decision: 'reject',
        note: null,
      }),
    )
  })

  it('reports an application decided meanwhile and reloads the card', async () => {
    let current = details()
    respond({
      'applications/get': () => current,
      'applications/decide': () => {
        current = details({
          status: 'officer_rejected',
          decidedAt: '2026-11-11',
        })
        throw new AppError('state_conflict')
      },
    })
    await renderApp({
      role: 'admin',
      path: `/applications/${APPLICATION_ID}`,
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Принять' }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Принять' }))
    expect(await screen.findByText(/Заявка уже рассмотрена/)).toBeVisible()
    expect(await screen.findByText('Заявка отклонена офицером')).toBeVisible()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })
})

describe('applicant path (HOM-06)', () => {
  const cases: [ApplicationStatus | null, string, string][] = [
    [null, 'Аккаунт создан', 'Аккаунт'],
    ['pending_officer_review', 'Заявка отправлена', 'Проверка'],
    ['pending_vote', 'Заявка на голосовании', 'Голосование'],
    ['vote_completed', 'Голосование завершено', 'Администрация'],
    ['officer_rejected', 'Заявка отклонена', 'Решение'],
    ['admin_rejected', 'Заявка отклонена', 'Решение'],
  ]

  it.each(cases)('status %s', async (status, title, activeStep) => {
    await renderWithRouter(
      <ApplicantPath
        application={
          status ? { id: 'a1', status, submittedAt: '2026-11-10' } : null
        }
      />,
    )
    expect(screen.getByRole('heading', { name: title })).toBeVisible()
    const current = screen
      .getAllByRole('listitem')
      .find((item) => item.getAttribute('aria-current') === 'step')
    expect(current).toHaveTextContent(activeStep)
    expect(
      screen.queryByRole('link', { name: 'Подать новую заявку' }),
    ).toBeNull()
  })

  it('marks vote steps as skipped after a direct decision', async () => {
    await renderWithRouter(
      <ApplicantPath
        application={{
          id: 'a1',
          status: 'officer_rejected',
          submittedAt: '2026-11-10',
        }}
      />,
    )
    expect(
      screen.getAllByText('Не потребовалось: решение без голосования'),
    ).toHaveLength(2)
    expect(screen.getAllByLabelText('Пройдено')).toHaveLength(2)
  })

  it('offers a new application after a rejection', async () => {
    await renderWithRouter(
      <ApplicantPath
        application={{
          id: 'a1',
          status: 'officer_rejected',
          submittedAt: '2026-11-10',
        }}
        canResubmit
      />,
      { extraPaths: ['/account/application'] },
    )
    expect(
      screen.getByRole('link', { name: 'Подать новую заявку' }),
    ).toHaveAttribute('href', '/account/application')
  })
})

function applicantMe(extra: Record<string, unknown> = {}) {
  return {
    state: 'ready',
    email: 'anna@example.com',
    application: {
      id: 'a1',
      status: 'officer_rejected',
      submittedAt: '2026-11-08',
    },
    canResubmit: true,
    profile: {
      id: 'u1',
      displayName: 'Анна',
      gameNickname: 'Рейна',
      city: 'Москва',
      birthDate: '1995-04-12',
      classId: 7,
      className: 'Маг',
      about: 'Играю давно',
      avatarUrl: null,
      role: 'applicant',
      joinedOn: null,
      createdAt: '2026-11-08',
      ...extra,
    },
  }
}

describe('resubmission (APP-10, Q-37)', () => {
  it('shows the rejected path with a new application button on home', async () => {
    me.value = applicantMe()
    await renderApp({ role: 'applicant', path: '/' })
    expect(
      await screen.findByRole('heading', { name: 'Заявка отклонена' }),
    ).toBeVisible()
    expect(
      screen.getByRole('link', { name: 'Подать новую заявку' }),
    ).toBeVisible()
  })

  it('submits new links with the profile summary and goes home', async () => {
    me.value = applicantMe()
    respond({ 'applications/resubmit': () => applicantMe() })
    const { router } = await renderApp({
      role: 'applicant',
      path: '/account/application',
    })
    expect(await screen.findByText('Данные из профиля')).toBeVisible()
    expect(screen.getByText('Москва')).toBeVisible()
    expect(screen.queryAllByRole('textbox')).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: /Добавить ссылку/ }))
    fireEvent.change(screen.getByLabelText('Ссылка 1'), {
      target: { value: 'https://example.com/new.png' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Подать заявку' }))
    await waitFor(() =>
      expect(callApi).toHaveBeenCalledWith('applications/resubmit', {
        equipmentLinks: ['https://example.com/new.png'],
      }),
    )
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  it('rejects an invalid link before calling the server', async () => {
    me.value = applicantMe()
    await renderApp({ role: 'applicant', path: '/account/application' })
    fireEvent.click(
      await screen.findByRole('button', { name: /Добавить ссылку/ }),
    )
    fireEvent.change(screen.getByLabelText('Ссылка 1'), {
      target: { value: 'not a link' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Подать заявку' }))
    expect(
      await screen.findByText(
        'Нужна ссылка, начинающаяся с http:// или https://',
      ),
    ).toBeVisible()
    expect(callApi).not.toHaveBeenCalledWith(
      'applications/resubmit',
      expect.anything(),
    )
  })

  it('sends the applicant to the account when profile fields are empty', async () => {
    me.value = applicantMe({ city: null, about: null })
    await renderApp({ role: 'applicant', path: '/account/application' })
    const notice = await screen.findByRole('alert')
    expect(notice).toHaveTextContent('город, рассказ о себе')
    expect(
      within(notice).getByRole('link', { name: 'Открыть кабинет' }),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Подать заявку' })).toBeDisabled()
  })

  it('redirects to the account when a new application is not allowed', async () => {
    me.value = applicantMe()
    ;(me.value as { canResubmit: boolean }).canResubmit = false
    const { router } = await renderApp({
      role: 'applicant',
      path: '/account/application',
    })
    await waitFor(() => expect(router.state.location.pathname).toBe('/account'))
  })
})
