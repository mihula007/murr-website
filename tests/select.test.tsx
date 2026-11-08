import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Select } from '@/components/ui/select'

describe('Select', () => {
  it('opens with the keyboard and selects an option', () => {
    render(
      <Select
        aria-label="Класс"
        placeholder="Выберите класс"
        options={[
          { value: 'warrior', label: 'Воин' },
          { value: 'mage', label: 'Маг' },
        ]}
      />,
    )
    const trigger = screen.getByRole('combobox', { name: 'Класс' })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(screen.getByRole('option', { name: 'Воин' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('option', { name: 'Маг' }))
    expect(trigger).toHaveTextContent('Маг')
  })
})
