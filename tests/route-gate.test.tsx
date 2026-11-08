import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ACCESS_ROLES } from '@/app/access'
import { NAV_SECTIONS } from '@/app/navigation'
import { renderApp } from './support/render-app'

describe('контроль доступа к маршрутам', () => {
  it('гость на /votes видит «Нет доступа» без заголовка раздела', async () => {
    await renderApp({ role: 'guest', path: '/votes' })
    expect(
      await screen.findByRole('heading', { name: 'Нет доступа' }),
    ).toBeVisible()
    expect(
      screen.queryByRole('heading', { name: 'Голосование' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Раздел в разработке')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Войти' })).toBeVisible()
  })

  it('член клана видит заглушку раздела', async () => {
    await renderApp({ role: 'member', path: '/votes' })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Голосование' }),
    ).toBeVisible()
    expect(screen.getByText('Раздел в разработке')).toBeVisible()
  })

  it('член клана на /admin видит «Нет доступа» и ссылку на главную', async () => {
    await renderApp({ role: 'member', path: '/admin' })
    expect(
      await screen.findByRole('heading', { name: 'Нет доступа' }),
    ).toBeVisible()
    expect(screen.getByRole('link', { name: 'На главную' })).toBeVisible()
  })

  it('прямой переход офицера на /applications работает при новой загрузке (HOM-14)', async () => {
    const first = await renderApp({ role: 'officer', path: '/applications' })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Заявки' }),
    ).toBeVisible()
    first.unmount()
    await renderApp({ role: 'officer', path: '/applications' })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Заявки' }),
    ).toBeVisible()
  })

  it.each(ACCESS_ROLES)(
    'роль %s получает доступ ровно к разделам из таблицы',
    async (role) => {
      for (const section of NAV_SECTIONS) {
        const view = await renderApp({ role, path: section.path })
        const allowed = section.roles.includes(role)
        const heading = await screen.findByRole('heading', { level: 1 })
        expect(heading).toHaveTextContent(
          allowed ? section.label : 'Нет доступа',
        )
        view.unmount()
      }
    },
  )

  it('кабинет доступен всем ролям', async () => {
    for (const role of ACCESS_ROLES) {
      const view = await renderApp({ role, path: '/account' })
      expect(
        await screen.findByRole('heading', {
          level: 1,
          name: role === 'guest' ? 'Вход' : 'Личный кабинет',
        }),
      ).toBeVisible()
      view.unmount()
    }
  })
})
