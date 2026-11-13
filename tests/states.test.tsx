import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EmptyState } from '@/components/states/empty-state'
import { ErrorState } from '@/components/states/error-state'
import { ForbiddenState } from '@/components/states/forbidden-state'
import { LoadingState } from '@/components/states/loading-state'
import { PageHeader } from '@/components/states/page-header'
import { renderWithRouter } from './support/render-with-router'

describe('общие состояния страницы', () => {
  it('PageHeader показывает заголовок, подзаголовок и действия', () => {
    render(
      <PageHeader
        title="События"
        description="Расписание клана"
        actions={<button type="button">Создать</button>}
      />,
    )
    expect(
      screen.getByRole('heading', { level: 1, name: 'События' }),
    ).toBeVisible()
    expect(screen.getByText('Расписание клана')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Создать' })).toBeVisible()
  })

  it('LoadingState помечен aria-busy', () => {
    render(<LoadingState />)
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('Загрузка…')).toBeInTheDocument()
  })

  it('EmptyState показывает заголовок, описание и действие', () => {
    render(
      <EmptyState
        title="Пока пусто"
        description="Записей нет"
        action={<button type="button">Добавить</button>}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Пока пусто' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Добавить' })).toBeVisible()
  })

  it('ErrorState имеет роль alert и вызывает onRetry', () => {
    const onRetry = vi.fn<() => void>()
    render(<ErrorState onRetry={onRetry} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Что-то пошло не так')
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('ErrorState без onRetry не показывает кнопку', () => {
    render(<ErrorState />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('ForbiddenState предлагает гостю войти', async () => {
    await renderWithRouter(<ForbiddenState accessRole="guest" />, {
      path: '/votes',
      extraPaths: ['/login'],
    })
    expect(
      await screen.findByRole('heading', { name: 'Нет доступа' }),
    ).toBeVisible()
    expect(screen.getByRole('link', { name: 'Войти' })).toHaveAttribute(
      'href',
      '/login',
    )
  })

  it('ForbiddenState возвращает чтеца на главную', async () => {
    await renderWithRouter(<ForbiddenState accessRole="reader" />, {
      path: '/votes',
    })
    expect(
      await screen.findByRole('link', { name: 'На главную' }),
    ).toHaveAttribute('href', '/')
    expect(
      screen.queryByRole('link', { name: 'Войти' }),
    ).not.toBeInTheDocument()
  })
})
