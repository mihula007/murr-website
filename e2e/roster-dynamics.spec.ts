import { expect, test, type Page } from '@playwright/test'
import { hasHorizontalScroll, skipSplash } from './helpers'
import { createMember, expectSignedIn, signInUi } from './supabase'

test.skip(
  ({ baseURL }) => Boolean(baseURL?.includes('/repository/')),
  'Сценарий состава проверяется на корневом пути',
)

test.beforeEach(async ({ page }) => {
  test.setTimeout(120_000)
  await skipSplash(page)
})

async function openDynamics(page: Page) {
  await page.goto('./#/roster')
  await page.getByRole('button', { name: 'Динамика развития' }).first().click()
  const dialog = page.getByRole('dialog')
  await expect(
    dialog.getByRole('heading', { name: 'Динамика развития' }),
  ).toBeVisible()
  return dialog
}

test('участник видит историю характеристик и недельные посещения на телефоне', async ({
  page,
}) => {
  await signInUi(page, 'seed-member-1@example.test')
  await expectSignedIn(page)
  const dialog = await openDynamics(page)
  await expect(dialog.getByRole('checkbox', { name: 'ПА' })).toBeChecked()
  await dialog.getByRole('checkbox', { name: 'ПЗ' }).check()
  const statChart = dialog.getByRole('region', {
    name: 'График характеристик',
  })
  await expect(statChart).toBeVisible()
  await expect(
    dialog.getByRole('region', { name: 'График характеристик' }),
  ).toHaveCount(1)
  const statPoint = statChart.locator('circle').first()
  await statPoint.hover()
  await expect(dialog.getByRole('status')).toContainText(/ПА|ПЗ/)
  await dialog.getByRole('combobox', { name: 'Период истории' }).click()
  await page.getByRole('option', { name: '90 дней' }).click()
  await dialog.getByRole('button', { name: 'Посещение ивентов' }).click()
  await expect(
    dialog.getByRole('region', { name: 'Посещение ивентов по неделям' }),
  ).toBeVisible()
  const attendanceChart = dialog.getByRole('region', {
    name: 'Посещение ивентов по неделям',
  })
  await expect(attendanceChart.locator('circle')).not.toHaveCount(0)
  await attendanceChart.locator('circle').first().hover()
  await expect(dialog.getByRole('status')).toContainText('Неделя с')
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await hasHorizontalScroll(page)).toBe(false)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('администратор открывает динамику и видит дату вступления участника', async ({
  page,
}) => {
  await signInUi(page, 'seed-admin@example.test')
  await expectSignedIn(page)
  const dialog = await openDynamics(page)
  await expect(dialog.getByText(/В клане с \d{2}\.\d{2}\.\d{4}/)).toBeVisible()
})

test('reader and applicant cannot open the dynamics dialog', async ({
  browser,
}) => {
  for (const role of ['reader', 'applicant'] as const) {
    const user = await createMember(role)
    const context = await browser.newContext()
    const page = await context.newPage()
    await skipSplash(page)
    await signInUi(page, user.email)
    await expectSignedIn(page)
    await page.goto('./#/roster')
    await expect(
      page.getByRole('heading', { name: 'Нет доступа' }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Динамика развития' }),
    ).toHaveCount(0)
    await context.close()
  }
})
