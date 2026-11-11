import { expect, test } from '@playwright/test'
import { MEMBER_LIST_LIMIT } from '../supabase/functions/_shared/contracts/paging'
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
 * Состав — участники клана целиком одним ответом (Q-48); аккаунты — большой
 * список: догрузка по курсору при прокрутке и отрисовка только видимых строк.
 */
test('состав приходит целиком, аккаунты догружаются страницами', async ({
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

  let rosterRequests = 0
  page.on('request', (request) => {
    if (request.url().endsWith('/functions/v1/api/roster/list')) {
      rosterRequests++
    }
  })
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
  // Весь состав — в одном ответе и в DOM, но не больше страховочного порога
  // (локальная БД копит участников от прогона к прогону).
  await expect(roster.getByRole('listitem')).toHaveCount(
    Math.min(total, MEMBER_LIST_LIMIT),
  )
  if (total > MEMBER_LIST_LIMIT) {
    await expect(
      page.getByText(`Показаны первые ${MEMBER_LIST_LIMIT} участников`),
    ).toBeVisible()
  } else {
    await scrollUntilVisible(page, page.getByRole('heading', { name: last }))
  }
  expect(rosterRequests).toBe(1)
  expect(await hasHorizontalScroll(page)).toBe(false)

  await page.goto('./#/admin')
  const rows = page.getByRole('row').filter({ hasText: '@example.test' })
  await expect(rows.first()).toBeVisible()
  expect(await rows.count()).toBeLessThan(total)
  await scrollUntilVisible(page, rows.filter({ hasText: last }))
  expect(await hasHorizontalScroll(page)).toBe(false)
})
