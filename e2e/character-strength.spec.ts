import { expect, test } from '@playwright/test'
import { hasHorizontalScroll, skipSplash } from './helpers'
import {
  accessToken,
  auditActions,
  callApi,
  createMember,
  expectSignedIn,
  localStack,
  signInUi,
  sql,
} from './supabase'

test.skip(
  ({ baseURL }) => Boolean(baseURL?.includes('/repository/')),
  'Сценарии состава проверяются на корневом пути',
)

test.beforeEach(async ({ page }) => {
  test.setTimeout(180_000)
  await skipSplash(page)
})

test('характеристики доступны админу и внутренним ролям, рейтинг сортируется', async ({
  page,
}) => {
  const [admin, first, second, applicant, reader] = await Promise.all([
    createMember('admin'),
    createMember('member'),
    createMember('member'),
    createMember('applicant'),
    createMember('reader'),
  ])
  await sql(
    (db) => db`
    update app.profiles set class_id = 1 where id = ${first.id}
  `,
  )
  await sql(
    (db) => db`
    update app.profiles set class_id = 7 where id = ${second.id}
  `,
  )

  const notificationsBefore = await sql(
    (db) => db<{ count: number }[]>`
      select count(*)::integer as count from app.user_notifications
      where recipient_id = ${first.id}`,
  )

  await signInUi(page, admin.email)
  await expectSignedIn(page)
  await page.goto('./#/admin')

  for (const [member, value] of [
    [first, '125,5к'],
    [second, '80к'],
  ] as const) {
    await page
      .getByLabel('Поиск по нику, имени, email и классу')
      .fill(member.nickname)
    await expect(page.getByText('Аккаунтов: 1', { exact: true })).toBeVisible()
    await expect(page.getByText(member.nickname, { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Карточка' }).click()
    const accountCard = page.getByRole('dialog', { name: 'Карточка аккаунта' })
    await expect(accountCard.getByText(member.email)).toBeVisible()
    await accountCard
      .getByText('Характеристика персонажа', { exact: true })
      .click()
    await accountCard.getByLabel('ПА').fill(value)
    await accountCard.getByLabel('ПА').press('Tab')
    await expect(accountCard.getByLabel('ПА')).toHaveValue(value)
    if (member.id === first.id) {
      await accountCard.getByLabel('Источник').fill('Прототип HTML')
      await accountCard.getByLabel('Источник').press('Tab')
    }
    await page.keyboard.press('Escape')
  }

  const actions = await auditActions(first.id)
  expect(actions.length).toBeGreaterThanOrEqual(2)
  const notificationsAfter = await sql(
    (db) => db<{ count: number }[]>`
      select count(*)::integer as count from app.user_notifications
      where recipient_id = ${first.id}`,
  )
  expect(notificationsAfter[0]!.count).toBe(notificationsBefore[0]!.count)

  const memberToken = await accessToken(first.email)
  const rosterResponse = await callApi('roster/list', memberToken)
  expect(rosterResponse.status).toBe(200)
  const listedMember = (
    rosterResponse.body.items as Record<string, unknown>[]
  ).find((item) => item.gameNickname === first.nickname)
  expect(listedMember).toMatchObject({ pa: 125500 })
  expect(listedMember).not.toHaveProperty('characterStatsSource')

  for (const email of [applicant.email, reader.email]) {
    const response = await callApi('roster/list', await accessToken(email))
    expect(response.status).not.toBe(200)
  }
  const guestResponse = await callApi('roster/list', localStack().ANON_KEY)
  expect(guestResponse.status).not.toBe(200)

  await signInUi(page, first.email)
  await expectSignedIn(page)
  await page.goto('./#/roster')
  const firstCard = page
    .getByRole('list', { name: 'Участники' })
    .getByRole('listitem')
    .filter({ hasText: first.nickname })
  await expect(firstCard.getByText('ПА')).toBeVisible()
  await expect(firstCard.getByText('125 500')).toBeVisible()
  await expect(firstCard.getByText('Прототип HTML')).toHaveCount(0)
  if ((page.viewportSize()?.width ?? 1280) < 900) {
    expect(await hasHorizontalScroll(page)).toBe(false)
  }

  await page.goto('./#/')
  const rating = page.getByRole('region', { name: 'Рейтинг силы' })
  const mobile = (page.viewportSize()?.width ?? 1280) < 900
  await expect(rating).toBeVisible()
  await expect(rating.getByText(first.nickname)).toBeVisible()
  await expect(rating.getByText(second.nickname)).toBeVisible()
  if (mobile) {
    expect(await hasHorizontalScroll(page)).toBe(false)
  }
  await expect(
    rating
      .locator('tbody tr')
      .filter({ hasText: first.nickname })
      .getByText('125 500'),
  ).toBeVisible()
  const paHeader = rating.getByRole('columnheader', { name: 'ПА' })
  if (!mobile) {
    await expect(paHeader).toHaveAttribute('aria-sort', 'descending')
  }
  let names = await rating.locator('tbody tr').allTextContents()
  expect(names.findIndex((name) => name.includes(first.nickname))).toBeLessThan(
    names.findIndex((name) => name.includes(second.nickname)),
  )
  if (mobile) {
    await rating.getByRole('button', { name: /По убыванию/ }).click()
    await expect(
      rating.getByRole('button', { name: /По возрастанию/ }),
    ).toBeVisible()
  } else {
    await rating.getByRole('button', { name: /ПА/ }).click()
    await expect(paHeader).toHaveAttribute('aria-sort', 'ascending')
  }
  names = await rating.locator('tbody tr').allTextContents()
  expect(
    names.findIndex((name) => name.includes(second.nickname)),
  ).toBeLessThan(names.findIndex((name) => name.includes(first.nickname)))
  if (mobile) {
    await rating.getByRole('button', { name: /По возрастанию/ }).click()
  } else {
    await rating.getByRole('button', { name: /ПА/ }).click()
    await expect(paHeader).toHaveAttribute('aria-sort', 'descending')
  }
  names = await rating.locator('tbody tr').allTextContents()
  expect(names.findIndex((name) => name.includes(first.nickname))).toBeLessThan(
    names.findIndex((name) => name.includes(second.nickname)),
  )
  await rating.getByRole('combobox', { name: 'Класс' }).click()
  await page.getByRole('option', { name: 'Маг', exact: true }).click()
  await expect(rating.getByText(second.nickname)).toBeVisible()
  await expect(rating.getByText(first.nickname)).toHaveCount(0)
})
