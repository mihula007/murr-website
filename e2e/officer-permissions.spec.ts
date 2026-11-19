import { expect, test } from '@playwright/test'
import { hasHorizontalScroll, skipSplash } from './helpers'
import {
  accessToken,
  callApi,
  createMember,
  expectSignedIn,
  signInUi,
  sql,
} from './supabase'

test('OFP: администратор настраивает права офицера, а сервер отклоняет действие без права', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000)
  const admin = await createMember('admin')
  const officer = await createMember('officer', { officerPermissions: [] })

  await skipSplash(page)
  await signInUi(page, admin.email)
  await expectSignedIn(page)
  await page.goto('./#/permissions')
  await expect(page.getByRole('heading', { name: 'Мастерка' })).toBeVisible()

  const officerSelect = page.getByRole('combobox', {
    name: 'Выбрать офицера',
  })
  await officerSelect.click()
  await page.getByRole('option', { name: officer.nickname }).click()

  const switches = page.getByRole('switch')
  await expect(switches).toHaveCount(20)
  for (const permission of await switches.all()) {
    await expect(permission).not.toBeChecked()
  }
  await page
    .getByRole('switch', { name: 'Создавать и отправлять рассылки' })
    .check()
  await page
    .getByRole('switch', {
      name: 'Просматривать полный состав участников и группы ивента',
    })
    .check()
  await page
    .getByRole('switch', { name: 'Просматривать, кто как проголосовал' })
    .check()
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(page.getByText('Права сохранены')).toBeVisible()
  await page.reload()
  await officerSelect.click()
  await page.getByRole('option', { name: officer.nickname }).click()
  await expect(
    page.getByRole('switch', { name: 'Создавать и отправлять рассылки' }),
  ).toBeChecked()
  await expect(
    page.getByRole('switch', {
      name: 'Просматривать полный состав участников и группы ивента',
    }),
  ).toBeChecked()
  await expect(
    page.getByRole('switch', { name: 'Просматривать, кто как проголосовал' }),
  ).toBeChecked()

  const officerPage = await browser.newPage()
  await skipSplash(officerPage)
  await signInUi(officerPage, officer.email)
  await expectSignedIn(officerPage)
  await officerPage.goto('./#/permissions')
  await expect(
    officerPage.getByRole('heading', { name: 'Нет доступа' }),
  ).toBeVisible()
  await officerPage.setViewportSize({ width: 390, height: 844 })
  await officerPage.goto('./#/events')
  expect(await hasHorizontalScroll(officerPage)).toBe(false)
  await officerPage.close()

  const token = await accessToken(officer.email)
  const rejected = await callApi('events/create', token, {})
  expect(rejected.status).toBe(403)
  const adminToken = await accessToken(admin.email)
  expect(
    (
      await callApi('accounts/set-role', adminToken, {
        userId: officer.id,
        role: 'member',
      })
    ).status,
  ).toBe(200)
  expect(
    (
      await callApi('accounts/set-role', adminToken, {
        userId: officer.id,
        role: 'officer',
      })
    ).status,
  ).toBe(200)
  const remainingPermissions = await sql(
    (db) => db<{ count: number }[]>`
      select count(*)::int as count from app.officer_permissions
      where officer_id = ${officer.id}::uuid
    `,
  )
  expect(remainingPermissions[0]?.count).toBe(0)
})
