import { useState } from 'react'
import {
  createHashHistory,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
  type RouterHistory,
} from '@tanstack/react-router'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard'

function FormPage() {
  const [saved, setSaved] = useState('')
  const [value, setValue] = useState('')
  const { dialog } = useUnsavedChangesGuard(value !== saved)
  return (
    <>
      <h1>Форма</h1>
      <label htmlFor="name">Имя</label>
      <input
        id="name"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <button type="button" onClick={() => setSaved(value)}>
        Сохранить
      </button>
      <Link to="/account">Уйти по ссылке</Link>
      {dialog}
    </>
  )
}

async function renderForm(history: RouterHistory) {
  const rootRoute = createRootRoute({ component: Outlet })
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/form',
        component: FormPage,
      }),
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/account',
        component: () => <h1>Другая страница</h1>,
      }),
    ]),
    history,
  })
  render(<RouterProvider router={router} />)
  await router.load()
  await screen.findByRole('heading', { name: 'Форма' })
  return router
}

const memory = () => createMemoryHistory({ initialEntries: ['/form'] })

function edit(value = 'Мурка') {
  fireEvent.change(screen.getByLabelText('Имя'), { target: { value } })
}

function leave() {
  fireEvent.click(screen.getByRole('link', { name: 'Уйти по ссылке' }))
}

describe('useUnsavedChangesGuard', () => {
  afterEach(() => {
    window.location.hash = ''
  })

  it('без изменений переход проходит без диалога', async () => {
    const router = await renderForm(memory())
    leave()
    expect(
      await screen.findByRole('heading', { name: 'Другая страница' }),
    ).toBeVisible()
    expect(router.state.location.pathname).toBe('/account')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('с изменениями показывает диалог; «Остаться» оставляет на странице', async () => {
    const router = await renderForm(memory())
    edit()
    leave()
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Уйти без сохранения?',
    })
    expect(dialog).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Остаться' }))
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
    )
    expect(router.state.location.pathname).toBe('/form')
    expect(screen.getByLabelText('Имя')).toHaveValue('Мурка')
  })

  it('«Уйти» выполняет переход', async () => {
    const router = await renderForm(memory())
    edit()
    leave()
    await screen.findByRole('alertdialog')
    fireEvent.click(screen.getByRole('button', { name: 'Уйти без сохранения' }))
    expect(
      await screen.findByRole('heading', { name: 'Другая страница' }),
    ).toBeVisible()
    expect(router.state.location.pathname).toBe('/account')
  })

  it('после сохранения блокировка снимается', async () => {
    const router = await renderForm(memory())
    edit()
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    leave()
    expect(
      await screen.findByRole('heading', { name: 'Другая страница' }),
    ).toBeVisible()
    expect(router.state.location.pathname).toBe('/account')
  })

  it('работает с hash-историей', async () => {
    window.location.hash = '#/form'
    const router = await renderForm(createHashHistory())
    edit()
    leave()
    await screen.findByRole('alertdialog')
    expect(window.location.hash).toBe('#/form')
    fireEvent.click(screen.getByRole('button', { name: 'Уйти без сохранения' }))
    await waitFor(() => expect(window.location.hash).toBe('#/account'))
    expect(router.state.location.pathname).toBe('/account')
  })

  it('с hash-историей включает beforeunload только при изменениях', async () => {
    window.location.hash = '#/form'
    await renderForm(createHashHistory())
    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)
    edit()
    const dirty = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirty)
    expect(dirty.defaultPrevented).toBe(true)
  })
})
