import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderApp } from './support/render-app'

function mainNav() {
  return screen.getByRole('navigation', { name: 'Основная навигация' })
}

function categoryButtons() {
  return within(mainNav()).queryAllByRole('button')
}

describe('оболочка приложения', () => {
  it('гость видит «Вход» и ни одной категории', async () => {
    await renderApp({ role: 'guest' })
    const banner = await screen.findByRole('banner')
    expect(within(banner).getByRole('link', { name: 'Вход' })).toHaveAttribute(
      'href',
      '/login',
    )
    expect(categoryButtons()).toHaveLength(0)
    expect(
      screen.queryByRole('button', { name: 'Открыть меню' }),
    ).not.toBeInTheDocument()
  })

  it.each(['applicant', 'reader'] as const)(
    'роль %s видит пустое меню без бургера',
    async (role) => {
      await renderApp({ role })
      expect(
        await screen.findByRole('link', { name: 'Аккаунт' }),
      ).toBeInTheDocument()
      expect(categoryButtons()).toHaveLength(0)
      expect(
        screen.queryByRole('button', { name: 'Открыть меню' }),
      ).not.toBeInTheDocument()
    },
  )

  it('член клана видит две категории', async () => {
    await renderApp({ role: 'member' })
    await screen.findByRole('link', { name: 'Аккаунт' })
    expect(categoryButtons().map((button) => button.textContent)).toEqual([
      'Клан',
      'Сообщество',
    ])
  })

  it('администратор видит три категории', async () => {
    await renderApp({ role: 'admin' })
    await screen.findByRole('link', { name: 'Аккаунт' })
    expect(categoryButtons().map((button) => button.textContent)).toEqual([
      'Клан',
      'Сообщество',
      'Управление',
    ])
  })

  it('открытие второй категории закрывает первую (HOM-03)', async () => {
    await renderApp({ role: 'admin' })
    const [clan, community] = categoryButtons()
    if (!clan || !community) throw new Error('Нет категорий')
    fireEvent.keyDown(clan, { key: 'Enter' })
    expect(
      await screen.findByRole('menuitem', { name: 'Ивенты' }),
    ).toBeInTheDocument()
    fireEvent.keyDown(community, { key: 'Enter' })
    expect(
      await screen.findByRole('menuitem', { name: 'Публикации' }),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(
        screen.queryByRole('menuitem', { name: 'Ивенты' }),
      ).not.toBeInTheDocument(),
    )
    expect(screen.getAllByRole('menu')).toHaveLength(1)
  })

  it('выбор раздела закрывает меню и выделяет активный раздел', async () => {
    const { router } = await renderApp({ role: 'member' })
    const [clan] = categoryButtons()
    if (!clan) throw new Error('Нет категорий')
    fireEvent.keyDown(clan, { key: 'Enter' })
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Голосование' }),
    )
    await waitFor(() => expect(router.state.location.pathname).toBe('/votes'))
    await waitFor(() =>
      expect(screen.queryByRole('menu')).not.toBeInTheDocument(),
    )
    expect(clan).toHaveAttribute('data-active')
    fireEvent.keyDown(clan, { key: 'Enter' })
    expect(
      await screen.findByRole('menuitem', { name: 'Голосование' }),
    ).toHaveAttribute('aria-current', 'page')
  })

  it('член клана получает бургер с теми же разделами', async () => {
    await renderApp({ role: 'member', path: '/events' })
    const burger = await screen.findByRole('button', { name: 'Открыть меню' })
    fireEvent.click(burger)
    const panel = await screen.findByRole('dialog', { name: 'Murr клан' })
    expect(within(panel).getByRole('link', { name: 'Ивенты' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(
      within(panel).queryByRole('link', { name: 'Заявки' }),
    ).not.toBeInTheDocument()
    fireEvent.click(within(panel).getByRole('link', { name: 'Состав' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    await waitFor(() => expect(burger).toHaveFocus())
  })
})
