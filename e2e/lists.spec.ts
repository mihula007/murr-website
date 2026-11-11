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

/**
 * Большие списки (AGENTS.md, «Списки»): больше одной страницы данных,
 * догрузка по курсору при прокрутке и отрисовка только видимых строк.
 */
test('состав и аккаунты догружаются страницами и виртуализированы', async ({
  page,
}) => {
  const seeded = await seedMembers(60, 'zl')
  const last = seeded
    .map((row) => row.nickname)
    .sort()
    .at(-1)!
  const admin = await createMember('admin')
  await signInUi(page, admin.email)
  await expectSignedIn(page)

  await page.goto('./#/roster')
  const roster = page.getByRole('list', { name: 'Участники' })
  await expect(roster.getByRole('listitem').first()).toBeVisible()
  const total = Number(
    await page
      .getByRole('region', { name: 'В составе' })
      .locator('strong')
      .textContent(),
  )
  expect(total).toBeGreaterThan(60)
  // В DOM — только видимые карточки, а не весь состав.
  expect(await roster.getByRole('listitem').count()).toBeLessThan(total)

  const nextPage = page.waitForRequest(
    (request) =>
      request.url().endsWith('/functions/v1/api/roster/list') &&
      !(request.postData() ?? '').includes('"cursor":null'),
  )
  await scrollUntilVisible(page, page.getByRole('heading', { name: last }))
  await nextPage
  expect(await roster.getByRole('listitem').count()).toBeLessThan(total)
  expect(await hasHorizontalScroll(page)).toBe(false)

  await page.goto('./#/admin')
  const rows = page.getByRole('row').filter({ hasText: '@example.test' })
  await expect(rows.first()).toBeVisible()
  expect(await rows.count()).toBeLessThan(total)
  await scrollUntilVisible(page, rows.filter({ hasText: last }))
  expect(await hasHorizontalScroll(page)).toBe(false)
})
