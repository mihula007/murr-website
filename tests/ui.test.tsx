import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

describe('guild UI primitives', () => {
  it('renders a disabled action as a native disabled button', () => {
    render(<Button disabled>Сохранить</Button>)
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled()
  })

  it('associates an input with its label', () => {
    render(
      <label htmlFor="name">
        Имя
        <Input id="name" />
      </label>,
    )
    expect(screen.getByRole('textbox', { name: 'Имя' })).toBeInTheDocument()
  })
})
