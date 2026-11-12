import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { pageItems, Pagination } from '@/components/ui/pagination'

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

describe('Pagination (Q-55)', () => {
  it('shows first, last and neighbour pages with gaps', () => {
    expect(pageItems(1, 5)).toEqual([1, 2, 3, 4, 5])
    expect(pageItems(1, 12)).toEqual([1, 2, 3, 4, 5, 'gap', 12])
    expect(pageItems(6, 12)).toEqual([1, 'gap', 5, 6, 7, 'gap', 12])
    expect(pageItems(12, 12)).toEqual([1, 'gap', 8, 9, 10, 11, 12])
  })

  it('marks the current page and reports the chosen one', () => {
    const onPageChange = vi.fn<(page: number) => void>()
    render(<Pagination page={2} pageCount={4} onPageChange={onPageChange} />)
    expect(screen.getByRole('button', { name: 'Страница 2' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByText('2 из 4')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Страница 4' }))
    fireEvent.click(screen.getByRole('button', { name: 'Следующая страница' }))
    expect(onPageChange.mock.calls).toEqual([[4], [3]])
  })

  it('disables arrows at the edges and hides itself for one page', () => {
    const { rerender } = render(
      <Pagination page={1} pageCount={3} onPageChange={() => {}} />,
    )
    expect(
      screen.getByRole('button', { name: 'Предыдущая страница' }),
    ).toBeDisabled()
    rerender(<Pagination page={1} pageCount={1} onPageChange={() => {}} />)
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })
})
