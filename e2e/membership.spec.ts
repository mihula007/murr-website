import { expect, test, type Browser } from '@playwright/test'
import { expectInternalMenu, hasHorizontalScroll, skipSplash } from './helpers'
import {
  accessToken,
  auditActions,
  callApi,
  createMember,
  expectSignedIn,
  moscowToday,
  PASSWORD,
  signInUi,
} from './supabase'

test.skip(
  ({ baseURL }) => Boolean(baseURL?.includes('/repository/')),
  'Сценарии членства проверяются на корневом пути',
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

test('E2E-06: блокировка в чтеца и восстановление офицером', async ({
  page,
  browser,
}) => {
  const member = await createMember('member')
  const admin = await createMember('admin')
  const officer = await createMember('officer')

  await signInUi(page, member.email)
  await expectSignedIn(page)
  await expectInternalMenu(page, true)

  // Администратор блокирует участника с карточки состава (ROS-07).
  const adminPage = await signedInPage(browser, admin.email)
  await adminPage.goto('./#/roster')
  const card = adminPage
    .getByRole('list', { name: 'Участники' })
    .getByRole('listitem')
    .filter({ has: adminPage.getByRole('heading', { name: member.nickname }) })
  await card.getByRole('button', { name: 'Присвоить статус «Чтец»' }).click()
  const blockDialog = adminPage.getByRole('alertdialog')
  await blockDialog.getByRole('button', { name: 'Присвоить «Чтец»' }).click()
  await expect(blockDialog).toBeHidden()
  await expect(card).toHaveCount(0)
  await expect(
    adminPage
      .getByRole('list', { name: 'Чтецы' })
      .getByRole('listitem')
      .filter({ hasText: member.nickname }),
  ).toBeVisible()
  await adminPage.context().close()

  // Чтец: права гостя, но вход, профиль и смена пароля остаются (ACL-06).
  await page.goto('./#/roster')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Нет доступа' })).toBeVisible()
  await expectInternalMenu(page, false)

  await page.goto('./#/account')
  await expect(page.getByText('Чтец · доступ только к профилю')).toBeVisible()
  await page.getByText('Личная информация', { exact: true }).click()
  await page.getByRole('button', { name: 'Изменить личную информацию' }).click()
  await page.getByLabel('Город').fill('Казань')
  await page.getByRole('button', { name: 'Сохранить профиль' }).click()
  await expect(page.getByText('Личная информация сохранена')).toBeVisible()

  await page.getByText('Смена пароля', { exact: true }).click()
  await page.getByLabel('Текущий пароль').fill(PASSWORD)
  await page.getByLabel('Новый пароль', { exact: true }).fill('new-password-2')
  await page.getByLabel('Повторите новый пароль').fill('new-password-2')
  await page.getByRole('button', { name: 'Изменить пароль' }).click()
  await expect(page.getByText('Пароль изменён')).toBeVisible()
  expect(await hasHorizontalScroll(page)).toBe(false)

  // Офицер восстанавливает чтеца из блока «Чтецы» (ACL-06, ADM-09).
  const officerPage = await signedInPage(browser, officer.email)
  await officerPage.goto('./#/roster')
  await expect(
    officerPage.getByRole('button', { name: 'Присвоить статус «Чтец»' }),
  ).toHaveCount(0)
  const reader = officerPage
    .getByRole('list', { name: 'Чтецы' })
    .getByRole('listitem')
    .filter({ hasText: member.nickname })
  await reader.getByRole('button', { name: 'Восстановить в клане' }).click()
  const restoreDialog = officerPage.getByRole('alertdialog')
  await restoreDialog.getByRole('button', { name: 'Восстановить' }).click()
  await expect(restoreDialog).toBeHidden()
  await expect(reader).toHaveCount(0)
  await expect(
    officerPage.getByRole('heading', { name: member.nickname }),
  ).toBeVisible()
  await officerPage.context().close()

  await page.reload()
  await expectInternalMenu(page, true)
  await expect(page.getByText('Принят в клан')).toBeVisible()
  await page.getByText('Личная информация', { exact: true }).click()
  await expect(page.getByText(moscowToday())).toBeVisible()

  expect(await auditActions(member.id)).toEqual([
    'member_blocked',
    'profile_updated',
    'reader_restored',
  ])
})

test('прямые вызовы запрещённых операций отклоняются', async () => {
  test.skip(
    test.info().project.name !== 'chromium',
    'Проверка API без интерфейса — один раз',
  )
  const [applicant, member, officer, target] = await Promise.all([
    createMember('applicant'),
    createMember('member'),
    createMember('officer'),
    createMember('member'),
  ])
  const unknownApplication = '00000000-0000-4000-8000-000000000000'
  const cases: [string, string, object][] = [
    [applicant.email, 'applications/list', { tab: 'new' }],
    [applicant.email, 'roster/list', {}],
    [member.email, 'applications/list', { tab: 'new' }],
    [
      member.email,
      'applications/decide',
      { id: unknownApplication, decision: 'accept' },
    ],
    [member.email, 'roster/readers', {}],
    [member.email, 'accounts/restore-reader', { userId: target.id }],
    [officer.email, 'accounts/list', {}],
    [officer.email, 'accounts/set-role', { userId: target.id, role: 'reader' }],
  ]
  const tokens = new Map<string, string>()
  for (const [email, route, body] of cases) {
    if (!tokens.has(email)) tokens.set(email, await accessToken(email))
    const result = await callApi(route, tokens.get(email)!, body)
    expect({ route, email, ...result }).toEqual({
      route,
      email,
      status: 403,
      body: { error: 'forbidden' },
    })
  }
  expect(await auditActions(target.id)).toEqual([])
})
