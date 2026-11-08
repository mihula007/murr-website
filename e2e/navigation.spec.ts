import { expect, test } from '@playwright/test'
import { hasHorizontalScroll, skipSplash } from './helpers'

test.beforeEach(async ({ page }) => {
  await skipSplash(page)
})

test('opens the shell without page errors or cloud requests', async ({
  page,
}) => {
  const errors: string[] = []
  const backendRequests: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => {
    if (request.url().includes('.supabase.co')) {
      backendRequests.push(request.url())
    }
  })

  await page.goto('./#/')
  await expect(page).toHaveTitle('Murr клан')
  await expect(
    page.getByRole('heading', { name: 'Легенда продолжается Вместе с Murr' }),
  ).toBeVisible()
  expect(errors).toEqual([])
  expect(backendRequests).toEqual([])
  expect(await hasHorizontalScroll(page)).toBe(false)
})

test('handles a direct unknown hash link and returns home after reload', async ({
  page,
}) => {
  await page.goto('./#/unknown/path')
  await page.reload()
  await expect(
    page.getByRole('heading', { name: 'Страница не найдена' }),
  ).toBeVisible()
  await page.getByRole('link', { name: 'На главную', exact: true }).click()
  await expect(page).toHaveURL(/#\/$/)
  await page.reload()
  await expect(
    page.getByRole('heading', { name: 'Легенда продолжается Вместе с Murr' }),
  ).toBeVisible()
})
