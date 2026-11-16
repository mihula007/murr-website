import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountCard, AccountListItem } from '@contracts/accounts'
import { AppError } from '@/lib/errors'
import { renderApp } from './support/render-app'

const callApi = vi.hoisted(() =>
  vi.fn<(route: string, body?: unknown) => Promise<unknown>>(),
)
vi.mock('@/lib/supabase/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  callApi,
}))

const account: AccountListItem = {
  id: 'm1',
  gameNickname: 'Боец',
  displayName: 'Имя Боец',
  email: 'm1@example.test',
  className: 'Воин',
  role: 'member',
  registeredAt: '2026-10-01T10:00:00Z',
  joinedOn: '2026-11-01',
  applicationStatus: null,
  isPrimaryAdmin: false,
  hasActiveApplication: false,
  deletionPending: false,
}

const card: AccountCard = {
  ...account,
  classId: 1,
  city: 'Москва',
  birthDate: null,
  about: null,
  avatarUrl: null,
  equipmentLinks: [],
  passwordSet: true,
  pa: null,
  pz: null,
  bu: null,
  hp: null,
  bd: null,
  characterStatsSource: null,
}

function respond(
  onSave?: (body: unknown) => unknown,
  current: AccountListItem = account,
) {
  callApi.mockImplementation((route, body) => {
    if (route === 'accounts/list') {
      return Promise.resolve({ items: [current], total: 1, nextCursor: null })
    }
    if (route === 'accounts/deletions') {
      return Promise.resolve({ items: [], truncated: false })
    }
    if (route === 'accounts/get') {
      return Promise.resolve({ ...card, ...current })
    }
    if (route === 'catalog/classes') {
      return Promise.resolve({
        classes: [
          { id: 1, slug: 'warrior', name: 'Воин' },
          { id: 2, slug: 'mage', name: 'Маг' },
        ],
      })
    }
    if (route === 'accounts/set-profile') {
      try {
        return Promise.resolve(onSave ? onSave(body) : body)
      } catch (error) {
        return Promise.reject(error)
      }
    }
    return new Promise(() => {})
  })
}

async function openCard() {
  await renderApp({ role: 'admin', path: '/admin' })
  await screen.findByRole('table')
  fireEvent.click(screen.getByRole('button', { name: 'Карточка' }))
  const dialog = await screen.findByRole('dialog', {
    name: 'Карточка аккаунта',
  })
  await within(dialog).findByText('m1@example.test')
  return dialog
}

function startEditing(dialog: HTMLElement) {
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'Изменить профиль' }),
  )
  return within(dialog).getByRole('region', {
    name: 'Изменение ника и класса',
  })
}

describe('изменение ника и класса в карточке администратора', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn<() => void>(),
    })
    callApi.mockReset()
    respond()
  })

  it('shows current values and opens the profile form', async () => {
    const dialog = await openCard()
    expect(
      within(dialog).getByText('Боец', { selector: 'strong' }),
    ).toBeVisible()
    expect(within(dialog).getByText('Воин')).toBeVisible()

    const profile = startEditing(dialog)

    expect(within(profile).getByLabelText('Игровой ник')).toHaveValue('Боец')
    await waitFor(() =>
      expect(
        within(profile).getByRole('combobox', { name: 'Класс' }),
      ).toHaveTextContent('Воин'),
    )
  })

  it('saves the nickname and class together in one operation', async () => {
    const dialog = await openCard()
    const profile = startEditing(dialog)
    fireEvent.change(within(profile).getByLabelText('Игровой ник'), {
      target: { value: 'Новенький' },
    })
    const classSelect = within(profile).getByRole('combobox', { name: 'Класс' })
    await waitFor(() => expect(classSelect).toHaveTextContent('Воин'))
    fireEvent.keyDown(classSelect, { key: 'ArrowDown' })
    fireEvent.click(await screen.findByRole('option', { name: 'Маг' }))
    const saveButton = within(profile).getByRole('button', {
      name: 'Сохранить',
    })
    await waitFor(() => expect(classSelect).toHaveTextContent('Маг'))
    await waitFor(() => expect(saveButton).toBeEnabled())
    fireEvent.click(saveButton)

    await waitFor(() =>
      expect(callApi).toHaveBeenCalledWith('accounts/set-profile', {
        userId: 'm1',
        gameNickname: 'Новенький',
        classId: 2,
      }),
    )
    expect(
      callApi.mock.calls.filter(([route]) => route === 'accounts/set-profile'),
    ).toHaveLength(1)
  })

  it('cancels the unsaved values without sending an update', async () => {
    const dialog = await openCard()
    const profile = startEditing(dialog)
    fireEvent.change(within(profile).getByLabelText('Игровой ник'), {
      target: { value: 'Черновой' },
    })
    fireEvent.click(within(profile).getByRole('button', { name: 'Отмена' }))

    expect(
      within(dialog).getByText('Боец', { selector: 'strong' }),
    ).toBeVisible()
    expect(
      callApi.mock.calls.some(([route]) => route === 'accounts/set-profile'),
    ).toBe(false)
  })

  it('shows a duplicate nickname error and keeps the form open', async () => {
    respond(() => {
      throw new AppError('validation_failed', {
        gameNickname: 'nickname_taken',
      })
    })
    const dialog = await openCard()
    const profile = startEditing(dialog)
    fireEvent.change(within(profile).getByLabelText('Игровой ник'), {
      target: { value: 'Занят' },
    })
    fireEvent.click(within(profile).getByRole('button', { name: 'Сохранить' }))

    expect(await within(profile).findByText('Этот ник уже занят')).toBeVisible()
    expect(within(profile).getByLabelText('Игровой ник')).toHaveValue('Занят')
  })

  it('keeps the profile form unchanged and disables save until edited', async () => {
    const dialog = await openCard()
    const profile = startEditing(dialog)
    expect(
      within(profile).getByRole('button', { name: 'Сохранить' }),
    ).toBeDisabled()
  })

  it('asks before closing the card while profile edits are unsaved', async () => {
    const dialog = await openCard()
    const profile = startEditing(dialog)
    fireEvent.change(within(profile).getByLabelText('Игровой ник'), {
      target: { value: 'Черновой' },
    })
    fireEvent.keyDown(document, { key: 'Escape' })

    const alert = await screen.findByRole('alertdialog', {
      name: 'Уйти без сохранения?',
    })
    fireEvent.click(within(alert).getByRole('button', { name: 'Остаться' }))
    expect(within(profile).getByLabelText('Игровой ник')).toHaveValue(
      'Черновой',
    )
  })

  it('blocks leaving without saving while a profile update is pending', async () => {
    let finishSave: (value: unknown) => void = () => {}
    respond(
      () =>
        new Promise((resolve) => {
          finishSave = resolve
        }),
    )
    const dialog = await openCard()
    const profile = startEditing(dialog)
    fireEvent.change(within(profile).getByLabelText('Игровой ник'), {
      target: { value: 'Новенький' },
    })
    fireEvent.click(within(profile).getByRole('button', { name: 'Сохранить' }))
    await waitFor(() =>
      expect(callApi).toHaveBeenCalledWith(
        'accounts/set-profile',
        expect.objectContaining({ gameNickname: 'Новенький' }),
      ),
    )
    fireEvent.keyDown(document, { key: 'Escape' })

    const alert = await screen.findByRole('alertdialog', {
      name: 'Уйти без сохранения?',
    })
    expect(
      within(alert).getByRole('button', { name: 'Уйти без сохранения' }),
    ).toBeDisabled()
    expect(
      within(alert).getByText(
        'Профиль сохраняется. Дождитесь окончания, прежде чем закрыть карточку.',
      ),
    ).toBeVisible()

    finishSave({ userId: 'm1', gameNickname: 'Новенький', classId: 1 })
    await waitFor(() =>
      expect(
        screen.queryByRole('alertdialog', { name: 'Уйти без сохранения?' }),
      ).not.toBeInTheDocument(),
    )
    expect(dialog).toBeInTheDocument()
  })
})
