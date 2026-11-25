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

test.skip(
  ({ baseURL }) => Boolean(baseURL?.includes('/repository/')),
  'Сценарии активности проверяются на корневом пути',
)

function moscowDate(days = 3) {
  return new Date(Date.now() + (3 + 24 * days) * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
}

async function closeWithLeader(
  managerToken: string,
  memberId: string,
  date: string,
  title: string,
) {
  const created = await callApi('events/create', managerToken, {
    title,
    type: 'pve',
    date,
    time: '20:00',
    description: 'Проверка корректировки активности',
  })
  expect(created.status).toBe(200)
  const eventId = created.body.id as string
  const createdGroup = await callApi('groups/create', managerToken, {
    eventId,
    name: `Пати ${title}`,
  })
  expect(createdGroup.status).toBe(200)
  const groupId = (createdGroup.body.groups as { id: string }[])[0]!.id
  expect(
    (
      await callApi('groups/move', managerToken, {
        eventId,
        userId: memberId,
        groupId,
      })
    ).status,
  ).toBe(200)
  expect(
    (
      await callApi('groups/set-leader', managerToken, {
        groupId,
        userId: memberId,
      })
    ).status,
  ).toBe(200)
  expect(
    (await callApi('events/close', managerToken, { id: eventId })).status,
  ).toBe(200)
  return eventId
}

async function actionCounts() {
  return sql(async (db) => {
    const audit = await db<{ count: number }[]>`
      select count(*)::int as count from app.audit_log
    `
    const notifications = await db<{ count: number }[]>`
      select count(*)::int as count from app.user_notifications
    `
    return [audit[0]!.count, notifications[0]!.count]
  })
}

test('E2E-18: мастер выдаёт отдельные права и корректировки синхронизируют сводку с рейтингом', async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000)
  const master = await createMember('master')
  const officer = await createMember('officer', { officerPermissions: [] })
  const member = await createMember('member')
  const masterToken = await accessToken(master.email)
  const firstDate = moscowDate()
  const firstEventId = await closeWithLeader(
    masterToken,
    member.id,
    firstDate,
    `E2E посещение ${Date.now()}`,
  )

  await skipSplash(page)
  await signInUi(page, master.email)
  await expectSignedIn(page)
  await page.goto('./#/permissions')
  await expect(page.getByRole('heading', { name: 'Мастерка' })).toBeVisible()
  const officerSelect = page.getByRole('combobox', {
    name: 'Выбрать офицера',
  })
  await officerSelect.click()
  await page.getByRole('option', { name: officer.nickname }).click()
  const ratingRight = page.getByRole('switch', {
    name: 'Корректировать рейтинг посещения',
  })
  const summaryRight = page.getByRole('switch', {
    name: 'Корректировать сводку учёта активности',
  })
  await expect(ratingRight).not.toBeChecked()
  await expect(summaryRight).not.toBeChecked()
  await page
    .getByText('Корректировать рейтинг посещения', { exact: true })
    .click()
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(page.getByText('Права сохранены')).toBeVisible()

  const officerPage = await browser.newPage()
  await skipSplash(officerPage)
  await signInUi(officerPage, officer.email)
  await expectSignedIn(officerPage)
  await officerPage.goto('./#/rating')
  const ratingTable = officerPage.getByRole('table', {
    name: 'Рейтинг посещения',
  })
  const ratingRow = ratingTable.getByRole('row').filter({
    hasText: member.nickname,
  })
  await expect(
    ratingRow.getByRole('button', { name: 'Корректировка' }),
  ).toBeVisible()
  expect(
    (
      await callApi(
        'activity/correct-summary',
        await accessToken(officer.email),
        { userId: member.id, visited: 2, missed: 0, unmarked: 0 },
      )
    ).status,
  ).toBe(403)

  await page.bringToFront()
  await officerSelect.click()
  await page.getByRole('option', { name: officer.nickname }).click()
  await page
    .getByText('Просматривать учёт активности, сводки и выгружать Excel', {
      exact: true,
    })
    .click()
  await page
    .getByText('Корректировать сводку учёта активности', { exact: true })
    .click()
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(page.getByText('Права сохранены')).toBeVisible()
  await officerPage.reload()
  await officerPage.goto('./#/activity')

  const summaryTable = officerPage.getByRole('table', {
    name: 'Сводка участников',
  })
  const summaryRow = summaryTable.getByRole('row').filter({
    hasText: member.nickname,
  })
  await summaryRow.getByRole('button', { name: 'Корректировка' }).click()
  let dialog = officerPage.getByRole('dialog')
  await dialog.getByLabel('Посетил', { exact: true }).fill('4')
  await dialog.getByLabel('Не посетил', { exact: true }).fill('1')
  await dialog.getByRole('button', { name: 'Сохранить' }).click()
  await expect(dialog).toBeHidden()
  await expect(summaryRow.getByRole('cell').nth(2)).toHaveText('4')
  await expect(summaryRow.getByRole('cell').nth(5)).toHaveText('80%')

  await officerPage.goto('./#/rating')
  await expect(ratingRow).toBeVisible()
  const beforeCorrectionActions = await actionCounts()
  const ratingVisited = ratingRow.getByRole('cell').nth(3)
  await ratingRow.getByRole('button', { name: 'Корректировка' }).click()
  dialog = officerPage.getByRole('dialog')
  await dialog.getByLabel('Посетил', { exact: true }).fill('5')
  await dialog.getByLabel('Пати-лидерство', { exact: true }).fill('4')
  await dialog.getByLabel('Дней в клане', { exact: true }).fill('8')
  await dialog.getByRole('button', { name: 'Сохранить' }).click()
  await expect(dialog).toBeHidden()
  await expect(ratingVisited).toHaveText('5')
  await expect(ratingRow.getByRole('cell').nth(6)).toHaveText('83%')
  await expect(ratingRow.getByRole('cell').nth(7)).toHaveText('4')
  await expect(ratingRow.getByRole('cell').nth(8)).toHaveText('8')
  await officerPage.goto('./#/activity')
  await expect(summaryRow).toBeVisible()
  await expect(summaryRow.getByRole('cell').nth(2)).toHaveText('5')
  await expect(summaryRow.getByRole('cell').nth(5)).toHaveText('83%')
  expect(await actionCounts()).toEqual(beforeCorrectionActions)

  const history = await callApi(
    'activity/history',
    await accessToken(officer.email),
    { search: member.nickname, limit: 20 },
  )
  expect(history.status).toBe(200)
  expect(history.body.items).toMatchObject([
    { eventId: firstEventId, status: 'visited', isLeader: true },
  ])

  await officerPage.goto(`./#/activity?from=${firstDate}`)
  const periodButtons = await officerPage
    .getByRole('button', {
      name: 'Корректировка',
    })
    .all()
  expect(periodButtons.length).toBeGreaterThan(0)
  for (const button of periodButtons) {
    await expect(button).toBeDisabled()
  }

  const secondEventId = await closeWithLeader(
    masterToken,
    member.id,
    moscowDate(4),
    `E2E новое посещение ${Date.now()}`,
  )
  expect(secondEventId).not.toBe(firstEventId)
  const refreshed = await callApi(
    'activity/summary',
    await accessToken(officer.email),
  )
  expect(refreshed.status).toBe(200)
  const corrected = (
    refreshed.body.items as { userId: string; visited: number }[]
  ).find((row) => row.userId === member.id)
  expect(corrected?.visited).toBe(6)

  await officerPage.setViewportSize({ width: 390, height: 844 })
  await officerPage.goto('./#/rating')
  await expect(
    officerPage.getByRole('table', { name: 'Рейтинг посещения' }),
  ).toBeVisible()
  expect(await hasHorizontalScroll(officerPage)).toBe(false)
  await officerPage.close()
})
