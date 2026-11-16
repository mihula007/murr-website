import { expect, test, type Browser } from '@playwright/test'
import { hasHorizontalScroll, scrollUntilVisible, skipSplash } from './helpers'
import {
  accessToken,
  callApi,
  createMember,
  expectSignedIn,
  signInUi,
} from './supabase'

test.skip(
  ({ baseURL }) => Boolean(baseURL?.includes('/repository/')),
  'Сценарий состава проверяется на корневом пути',
)

test.beforeEach(async ({ page }) => {
  test.setTimeout(120_000)
  await skipSplash(page)
})

async function signedInPage(browser: Browser, email: string) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await skipSplash(page)
  await signInUi(page, email)
  await expectSignedIn(page)
  return page
}

test('officer assigns a member the reader role from the roster', async ({
  page,
  browser,
}) => {
  const officer = await createMember('officer')
  const member = await createMember('member')

  await signInUi(page, officer.email)
  await expectSignedIn(page)
  await page.goto('./#/roster')
  const card = page
    .getByRole('list', { name: 'Участники' })
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: member.nickname }) })
  await scrollUntilVisible(page, card)
  await card.getByRole('button', { name: /^Действия с участником/ }).click()
  await page.getByRole('menuitem', { name: 'Присвоить статус «Чтец»' }).click()

  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText(
    `Присвоить ${member.nickname} статус «Чтец»?`,
  )
  await dialog.getByRole('button', { name: 'Присвоить «Чтец»' }).click()
  await expect(dialog).toBeHidden()
  await expect(card).toHaveCount(0)
  expect(
    (await callApi('roster/list', await accessToken(member.email))).status,
  ).toBe(403)
  expect(await hasHorizontalScroll(page)).toBe(false)

  const memberPage = await signedInPage(browser, member.email)
  await memberPage.goto('./#/roster')
  await expect(
    memberPage.getByRole('heading', { name: 'Нет доступа' }),
  ).toBeVisible()
  await memberPage.goto('./#/account')
  await expect(
    memberPage.getByText('Чтец · доступ только к профилю'),
  ).toBeVisible()
  await memberPage.context().close()
})
