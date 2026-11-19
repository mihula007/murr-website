import { expect, test, type Browser, type Page } from '@playwright/test'
import {
  expectInternalMenu,
  hasHorizontalScroll,
  scrollUntilVisible,
  skipSplash,
} from './helpers'
import {
  auditActions,
  accessToken,
  callApi,
  createMember,
  expectSignedIn,
  seedMembers,
  signInUi,
  sql,
} from './supabase'

test.skip(
  ({ baseURL }) => Boolean(baseURL?.includes('/repository/')),
  'Сценарий состава проверяется на корневом пути',
)

test.beforeEach(async ({ page }) => {
  test.setTimeout(120_000)
  await skipSplash(page)
})

async function openFiltersWhenNarrow(page: Page) {
  const button = page.getByRole('button', { name: 'Фильтры' })
  if (await button.isVisible()) {
    await button.click()
  }
}

async function signedInPage(browser: Browser, email: string) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await skipSplash(page)
  await signInUi(page, email)
  await expectSignedIn(page)
  return page
}

test('неограниченный состав ищет по серверу и прокручивается по устройству', async ({
  page,
}) => {
  const prefix = `R${Date.now().toString(36).slice(-3)}`
  const created = await seedMembers(26, prefix)
  const lastNickname = created
    .map((row) => row.nickname)
    .sort()
    .at(-1)!
  const member = await createMember('member')
  const requests: Array<Record<string, unknown>> = []
  page.on('request', (request) => {
    if (request.url().endsWith('/functions/v1/api/roster/page')) {
      requests.push(request.postDataJSON() as Record<string, unknown>)
    }
  })

  await page.setViewportSize({ width: 1280, height: 900 })
  await signInUi(page, member.email)
  await expectSignedIn(page)
  await page.goto('./#/roster')
  await page.getByLabel('Поиск', { exact: true }).fill(prefix)
  const classFilter = page.getByRole('combobox', { name: 'Класс' })
  await classFilter.click()
  await page.getByRole('option', { name: 'Оборотень' }).click()

  const desktopList = page.getByRole('region', {
    name: 'Прокручиваемый список: Участники',
  })
  await expect(desktopList).toBeVisible()
  await expect(desktopList).toHaveAttribute('data-viewport-rows', '4')
  await expect
    .poll(() =>
      requests.some(
        (request) =>
          request.search === prefix &&
          request.classId === 1 &&
          request.cursor === null,
      ),
    )
    .toBe(true)
  const desktopCards = desktopList.getByRole('list', { name: 'Участники' })
  const artwork = desktopCards.locator('img[aria-hidden="true"]')
  await expect(artwork.first()).toHaveAttribute('src', /werebeast-v1/)
  const artworkPaths = await artwork.evaluateAll((images) =>
    images.map((image) => image.getAttribute('src')),
  )
  expect(new Set(artworkPaths).size).toBeLessThanOrEqual(1)
  await desktopList.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await expect(
    desktopCards.getByRole('heading', { name: lastNickname }),
  ).toBeVisible()
  expect(await hasHorizontalScroll(page)).toBe(false)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await expect(page.getByLabel('Поиск', { exact: true })).toHaveValue(prefix)
  await expect(page.getByRole('combobox', { name: 'Класс' })).toContainText(
    'Оборотень',
  )
  await expect(
    page.getByRole('region', { name: 'Прокручиваемый список: Участники' }),
  ).toHaveCount(0)
  await scrollUntilVisible(
    page,
    page.getByRole('heading', { name: lastNickname }),
  )
  expect(await hasHorizontalScroll(page)).toBe(false)
})

test('officer assigns a member the reader role from the roster', async ({
  page,
  browser,
}) => {
  const officer = await createMember('officer')
  const member = await createMember('member')
  member.nickname = `0${member.nickname}`
  await sql(
    (db) =>
      db`update app.profiles set game_nickname = ${member.nickname} where id = ${member.id}`,
  )

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

test('E2E-15: admin assigns a master who changes member, officer, and reader roles', async ({
  page,
  browser,
}) => {
  const [
    admin,
    master,
    member,
    reader,
    officer,
    otherMaster,
    otherAdmin,
    candidate,
  ] = await Promise.all([
    createMember('admin'),
    createMember('member'),
    createMember('member'),
    createMember('reader'),
    createMember('officer'),
    createMember('master'),
    createMember('admin'),
    createMember('applicant'),
  ])

  await sql(async (db) => {
    await db`insert into app.join_applications (applicant_id, status)
      values (${candidate.id}, 'pending_officer_review')`
  })

  await signInUi(page, admin.email)
  await expectSignedIn(page)
  await page.goto('./#/admin')
  await openFiltersWhenNarrow(page)
  await page
    .getByLabel('Поиск по нику, имени, email и классу')
    .fill(master.nickname)
  const roleSelect = page.getByRole('combobox', {
    name: `Роль ${master.nickname}`,
  })
  await roleSelect.click()
  await page.getByRole('option', { name: 'Мастер' }).click()
  const assignment = page.getByRole('alertdialog')
  await expect(assignment).toContainText(`Сменить роль ${master.nickname}?`)
  await assignment.getByRole('button', { name: 'Сменить роль' }).click()
  await expect(assignment).toBeHidden()

  const masterPage = await signedInPage(browser, master.email)
  await expectInternalMenu(masterPage, true)
  await masterPage.goto('./#/admin')
  await expect(masterPage.getByText('Нет доступа')).toBeVisible()
  await masterPage.goto('./#/roster')

  const memberCard = masterPage
    .getByRole('list', { name: 'Участники' })
    .getByRole('listitem')
    .filter({ has: masterPage.getByRole('heading', { name: member.nickname }) })
  await scrollUntilVisible(masterPage, memberCard)
  await memberCard
    .getByRole('button', { name: /^Действия с участником/ })
    .click()
  await expect(
    masterPage.getByRole('menuitem', { name: 'Назначить роль «Кандидат»' }),
  ).toHaveCount(0)
  await masterPage
    .getByRole('menuitem', { name: 'Назначить роль «Офицер»' })
    .click()
  const memberChange = masterPage.getByRole('alertdialog')
  await expect(memberChange).toContainText(
    `Сменить роль ${member.nickname} на «Офицер»?`,
  )
  await memberChange.getByRole('button', { name: 'Сменить роль' }).click()
  await expect(memberChange).toBeHidden()
  await expect(memberCard).toContainText('Офицер')

  await memberCard
    .getByRole('button', { name: /^Действия с участником/ })
    .click()
  await expect(
    masterPage.getByRole('menuitem', { name: 'Назначить роль «Офицер»' }),
  ).toHaveCount(0)
  await masterPage
    .getByRole('menuitem', { name: 'Назначить роль «Член клана»' })
    .click()
  const officerDemotion = masterPage.getByRole('alertdialog')
  await officerDemotion.getByRole('button', { name: 'Сменить роль' }).click()
  await expect(officerDemotion).toBeHidden()
  await expect(memberCard).not.toContainText('Офицер')

  await masterPage.getByRole('tab', { name: 'Чтецы' }).click()
  const readerRow = masterPage
    .getByRole('list', { name: 'Чтецы' })
    .getByRole('listitem')
    .filter({ hasText: reader.nickname })
  await scrollUntilVisible(masterPage, readerRow)
  await readerRow
    .getByRole('button', { name: `Действия с чтецом «${reader.nickname}»` })
    .click()
  await expect(
    masterPage.getByRole('menuitem', { name: 'Назначить роль «Кандидат»' }),
  ).toHaveCount(0)
  await masterPage
    .getByRole('menuitem', { name: 'Назначить роль «Член клана»' })
    .click()
  const readerChange = masterPage.getByRole('alertdialog')
  await expect(readerChange).toContainText(
    `Сменить роль ${reader.nickname} на «Член клана»?`,
  )
  await readerChange.getByRole('button', { name: 'Сменить роль' }).click()
  await expect(readerChange).toBeHidden()
  await expect(readerRow).toHaveCount(0)

  const masterToken = await accessToken(master.email)
  expect(
    (
      await callApi('accounts/set-role', masterToken, {
        userId: officer.id,
        role: 'member',
      })
    ).status,
  ).toBe(200)
  for (const target of [master, otherMaster, otherAdmin, candidate]) {
    expect(
      (
        await callApi('accounts/set-role', masterToken, {
          userId: target.id,
          role: 'reader',
        })
      ).status,
    ).toBe(403)
  }
  for (const role of ['master', 'admin'] as const) {
    expect(
      (
        await callApi('accounts/set-role', masterToken, {
          userId: member.id,
          role,
        })
      ).status,
    ).toBe(403)
  }

  const memberToken = await accessToken(member.email)
  const notifications = await callApi('notifications/list', memberToken)
  expect(notifications.body.items).toEqual(
    expect.arrayContaining([expect.objectContaining({ kind: 'role_changed' })]),
  )
  expect(await auditActions(member.id)).toContain('role_changed')
  expect(await hasHorizontalScroll(masterPage)).toBe(false)
  await masterPage.context().close()
})
