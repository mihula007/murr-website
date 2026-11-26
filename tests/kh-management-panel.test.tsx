import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { KhManagementPanel } from '@/features/kh-queues/kh-management-panel'

describe('KhManagementPanel', () => {
  it('keeps the shared limit compact beside the queue tabs', () => {
    render(
      <KhManagementPanel value={2} onSave={vi.fn<(value: number) => void>()} />,
    )
    const panel = screen.getByRole('region', {
      name: 'Настройка лимита очередей',
    })
    expect(panel).toHaveClass('rounded-lg')
    expect(panel).not.toHaveClass('my-4')
    expect(
      screen.getByRole('combobox', { name: 'Лимит очередей на участника' }),
    ).toHaveTextContent('2')
  })
})
