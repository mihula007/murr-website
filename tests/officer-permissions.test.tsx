import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AccessProvider } from '@/app/access'
import { OfficerPermissionsPage } from '@/features/officer-permissions/permissions-page'
import { renderWithRouter } from './support/render-with-router'

const apiMock = vi.hoisted(() => ({
  roster: {
    isPending: false,
    isError: false,
    data: {
      officers: [
        { id: 'officer-1', nickname: 'Мурка', permissions: [] as string[] },
        { id: 'officer-2', nickname: 'Барс', permissions: [] as string[] },
      ],
    },
    refetch: vi.fn<() => Promise<unknown>>(),
  },
  save: {
    isPending: false,
    error: null as unknown,
    mutateAsync: vi.fn<(input: unknown) => Promise<unknown>>(),
    reset: vi.fn<() => void>(),
  },
}))

vi.mock('@/features/officer-permissions/api', () => ({
  useOfficerPermissionsRoster: () => apiMock.roster,
  useSaveOfficerPermissions: () => apiMock.save,
}))

vi.mock('@/components/ui/select', () => ({
  Select: (props: {
    options: { value: string; label: string }[]
    value?: string
    onValueChange: (value: string) => void
    'aria-label'?: string
  }) => (
    <select
      aria-label={props['aria-label']}
      value={props.value}
      onChange={(event) => props.onValueChange(event.currentTarget.value)}
    >
      {props.options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}))

async function renderPage() {
  const user = userEvent.setup()
  const queryClient = new QueryClient()
  const result = await renderWithRouter(
    <QueryClientProvider client={queryClient}>
      <AccessProvider {...{ role: 'master' as const }}>
        <OfficerPermissionsPage />
      </AccessProvider>
    </QueryClientProvider>,
    { path: '/permissions' },
  )
  return { ...result, user }
}

describe('Мастерка', () => {
  beforeEach(() => {
    apiMock.roster.isPending = false
    apiMock.roster.isError = false
    apiMock.roster.data.officers = [
      { id: 'officer-1', nickname: 'Мурка', permissions: [] },
      { id: 'officer-2', nickname: 'Барс', permissions: [] },
    ]
    apiMock.save.isPending = false
    apiMock.save.error = null
    apiMock.save.mutateAsync.mockReset()
  })

  it('starts with every switch off and the save button disabled', async () => {
    await renderPage()

    expect(screen.getAllByRole('switch')).toHaveLength(20)
    expect(
      screen.getByRole('switch', { name: 'Разбирать новые заявки' }),
    ).not.toBeChecked()
    expect(
      screen.getByRole('switch', {
        name: 'Просматривать, кто как проголосовал',
      }),
    ).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled()
  })

  it('clears application actions when review is switched off and saves once', async () => {
    const { user } = await renderPage()
    const review = screen.getByRole('switch', {
      name: 'Разбирать новые заявки',
    })
    const decideDirect = screen.getByRole('switch', {
      name: 'Принимать решение без голосования',
    })

    expect(decideDirect).toBeDisabled()
    await user.click(review)
    await user.click(decideDirect)
    expect(decideDirect).toBeChecked()

    await user.click(review)
    expect(decideDirect).not.toBeChecked()
    expect(decideDirect).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeEnabled()

    apiMock.save.mutateAsync.mockResolvedValueOnce({
      officer: { id: 'officer-1', nickname: 'Мурка' },
      permissions: [],
    })
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() =>
      expect(apiMock.save.mutateAsync).toHaveBeenCalledWith({
        officerId: 'officer-1',
        permissions: [],
      }),
    )
  })

  it('warns before changing the selected officer with unsaved changes', async () => {
    const { user } = await renderPage()
    await user.click(
      screen.getByRole('switch', { name: 'Разбирать новые заявки' }),
    )
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Выбрать офицера' }),
      'officer-2',
    )

    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(
      screen.getByText('Несохранённые права будут отброшены.'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Остаться' }))
    expect(
      screen.getByRole('switch', { name: 'Разбирать новые заявки' }),
    ).toBeChecked()
  })
})
