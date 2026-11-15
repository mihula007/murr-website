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

function respond(save?: (body: unknown) => unknown) {
  callApi.mockImplementation((route, body) => {
    if (route === 'accounts/list') {
      return Promise.resolve({ items: [account], total: 1, nextCursor: null })
    }
    if (route === 'accounts/deletions') {
      return Promise.resolve({ items: [], truncated: false })
    }
    if (route === 'accounts/get') {
      return Promise.resolve(card)
    }
    if (route === 'accounts/set-character-stats') {
      try {
        return Promise.resolve(save ? save(body) : body)
      } catch (error) {
        return Promise.reject(error)
      }
    }
    return new Promise(() => {})
  })
}

async function openStats() {
  await renderApp({ role: 'admin', path: '/admin' })
  await screen.findByRole('table')
  fireEvent.click(screen.getByRole('button', { name: 'Карточка' }))
  const dialog = await screen.findByRole('dialog', {
    name: 'Карточка аккаунта',
  })
  await within(dialog).findByText('m1@example.test')
  fireEvent.click(
    within(dialog).getByText('Характеристика персонажа', {
      selector: 'summary',
    }),
  )
  return dialog
}

describe('характеристики в карточке аккаунта администратора', () => {
  beforeEach(() => {
    callApi.mockReset()
    card.pz = null
    respond()
  })

  it('shows the five values and source and saves all of them with one button', async () => {
    const dialog = await openStats()
    for (const label of ['ПА', 'ПЗ', 'БУ', 'ХП', 'БД', 'Источник']) {
      expect(within(dialog).getByLabelText(label)).toBeVisible()
    }
    const save = within(dialog).getByRole('button', { name: 'Сохранить' })
    expect(save).toBeDisabled()

    fireEvent.change(within(dialog).getByLabelText('ПА'), {
      target: { value: '125,5к' },
    })
    fireEvent.blur(within(dialog).getByLabelText('ПА'))
    fireEvent.change(within(dialog).getByLabelText('ХП'), {
      target: { value: '2к' },
    })
    expect(
      callApi.mock.calls.filter(
        ([route]) => route === 'accounts/set-character-stats',
      ),
    ).toHaveLength(0)
    fireEvent.click(save)

    await waitFor(() =>
      expect(callApi).toHaveBeenCalledWith('accounts/set-character-stats', {
        userId: 'm1',
        pa: '125,5к',
        pz: null,
        bu: null,
        hp: '2к',
        bd: null,
        source: null,
      }),
    )
    expect(
      callApi.mock.calls.filter(
        ([route]) => route === 'accounts/set-character-stats',
      ),
    ).toHaveLength(1)
  })

  it('sends an emptied field as null', async () => {
    respond((body) => body)
    card.pz = 20
    const dialog = await openStats()
    fireEvent.change(within(dialog).getByLabelText('ПЗ'), {
      target: { value: '' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }))
    await waitFor(() =>
      expect(callApi).toHaveBeenCalledWith(
        'accounts/set-character-stats',
        expect.objectContaining({ userId: 'm1', pz: null }),
      ),
    )
  })

  it('rejects an invalid number before saving', async () => {
    const dialog = await openStats()
    const pa = within(dialog).getByLabelText('ПА')
    fireEvent.change(pa, { target: { value: 'не число' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }))

    expect(
      await within(dialog).findByText(
        'Введите число или число с «к» для тысяч',
      ),
    ).toBeVisible()
    expect(pa).toHaveValue('не число')
    expect(
      callApi.mock.calls.filter(
        ([route]) => route === 'accounts/set-character-stats',
      ),
    ).toHaveLength(0)
  })

  it('shows a server field error under that field', async () => {
    respond(() => {
      throw new AppError('validation_failed', { bd: 'invalid_number' })
    })
    const dialog = await openStats()
    fireEvent.change(within(dialog).getByLabelText('БД'), {
      target: { value: '5' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }))
    expect(
      await within(dialog).findByText(
        'Введите число или число с «к» для тысяч',
      ),
    ).toBeVisible()
  })
})
