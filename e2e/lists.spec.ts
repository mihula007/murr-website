import { expect, test } from '@playwright/test'
import { hasHorizontalScroll, scrollUntilVisible, skipSplash } from './helpers'
import { createMember, expectSignedIn, seedMembers, signInUi } from './supabase'

test.skip(
  ({ baseURL }) => Boolean(baseURL?.includes('/repository/')),
  'Большие списки проверяются на корневом пути',
)

test.beforeEach(async ({ page }) => {
  test.setTimeout(120_000)
  await skipSplash(page)
})

/** Состав и аккаунты догружаются курсорными страницами без лимита записей. */
test('состав и аккаунты догружаются страницами', async ({ page }) => {
  const seeded = await seedMembers(60, 'zl')
  const last = seeded
    .map((row) => row.nickname)
    .sort()
    .at(-1)!
  const admin = await createMember('admin')
  await signInUi(page, admin.email)
  await expectSignedIn(page)

  // Считаем запросы только с чистой загрузки страницы состава.
  await page.goto('./#/roster')
  let rosterPageRequests = 0
  let rosterListRequests = 0
  page.on('request', (request) => {
    if (request.url().endsWith('/functions/v1/api/roster/page')) {
      rosterPageRequests++
    }
    if (request.url().endsWith('/functions/v1/api/roster/list')) {
      rosterListRequests++
    }
  })
  await page.reload()
  const roster = page.getByRole('list', { name: 'Участники' })
  await expect(roster.getByRole('listitem').first()).toBeVisible()
  const total = Number(
    await page
      .getByRole('region', { name: 'В составе' })
      .locator('strong')
      .textContent(),
  )
  expect(total).toBeGreaterThan(60)
  await scrollUntilVisible(page, page.getByRole('heading', { name: last }))
  await expect(page.getByRole('heading', { name: last })).toBeVisible()
  expect(rosterPageRequests).toBeGreaterThan(1)
  expect(rosterListRequests).toBe(0)
  expect(await hasHorizontalScroll(page)).toBe(false)

  await page.goto('./#/admin')
  const rows = page.getByRole('row').filter({ hasText: '@example.test' })
  await expect(rows.first()).toBeVisible()
  expect(await rows.count()).toBeLessThan(total)
  await scrollUntilVisible(page, rows.filter({ hasText: last }))
  expect(await hasHorizontalScroll(page)).toBe(false)
})
