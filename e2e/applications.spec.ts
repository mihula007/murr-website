import { expect, test, type Browser, type Page } from '@playwright/test'
import { expectInternalMenu, hasHorizontalScroll, skipSplash } from './helpers'
import {
  auditActions,
  createMember,
  expectSignedIn,
  moscowToday,
  registerApplicant,
  signInUi,
  sql,
} from './supabase'

test.skip(
  ({ baseURL }) => Boolean(baseURL?.includes('/repository/')),
  'Сценарии заявок проверяются на корневом пути',
)

test.beforeEach(async ({ page }) => {
  // Регистрация через Auth и Mailpit, несколько входов и вызовов функции.
  test.setTimeout(120_000)
  await skipSplash(page)
})

/** Отдельный браузерный контекст — второй пользователь со своей сессией. */
async function signedInPage(browser: Browser, email: string) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await skipSplash(page)
  await signInUi(page, email)
  await expectSignedIn(page)
  return page
}

async function memberCount(page: Page) {
  const value = page
    .getByRole('region', { name: 'Численность клана' })
    .locator('strong')
  await expect(value).toHaveText(/^\d+$/, { timeout: 15_000 })
  return Number(await value.textContent())
}

/** Офицер открывает заявку кандидата из очереди «Новые» и решает её. */
async function decide(
  page: Page,
  nickname: string,
  decision: 'Принять' | 'Отклонить',
) {
  await page.goto('./#/applications')
  await page.getByRole('link', { name: new RegExp(nickname) }).click()
  await expect(page.getByRole('heading', { name: nickname })).toBeVisible()
  expect(await hasHorizontalScroll(page)).toBe(false)
  await page.getByRole('button', { name: decision, exact: true }).click()
  const dialog = page.getByRole('alertdialog')
  await dialog.getByRole('button', { name: decision, exact: true }).click()
  await expect(dialog).toBeHidden()
}

test('E2E-02: офицер принимает заявку, кандидат становится членом клана', async ({
  page,
  browser,
}) => {
  const applicant = await registerApplicant()
  const officer = await createMember('officer')

  await signInUi(page, applicant.email)
  await expectSignedIn(page)
  await expect(
    page.getByRole('heading', { name: 'Заявка отправлена' }),
  ).toBeVisible()
  await expectInternalMenu(page, false)
  const before = await memberCount(page)

  const officerPage = await signedInPage(browser, officer.email)
  await decide(officerPage, applicant.nickname, 'Принять')
  await expect(
    officerPage.getByText('Заявка подтверждена офицером'),
  ).toBeVisible()
  await officerPage.context().close()

  // Роль приходит из `account/me` после перезагрузки.
  await page.reload()
  await expectInternalMenu(page, true)
  // Другие сценарии могут параллельно добавлять участников.
  expect(await memberCount(page)).toBeGreaterThanOrEqual(before + 1)

  await page.goto('./#/roster')
  await expect(
    page.getByRole('heading', { name: applicant.nickname }),
  ).toBeVisible()
  expect(await hasHorizontalScroll(page)).toBe(false)

  await page.goto('./#/account')
  await expect(page.getByText('Принят в клан')).toBeVisible()
  await page.getByText('Личная информация', { exact: true }).click()
  await expect(page.getByText(moscowToday())).toBeVisible()

  expect(await auditActions(applicant.id)).toContain(
    'application_accepted_directly',
  )
  const [notification] = await sql(
    (db) => db<{ kind: string }[]>`select kind from app.user_notifications
      where recipient_id = ${applicant.id}`,
  )
  expect(notification?.kind).toBe('application_accepted')
})

test('отказ и новая заявка; вторая вкладка не подаёт повторно', async ({
  page,
  browser,
}) => {
  const applicant = await registerApplicant()
  const officer = await createMember('officer')

  const officerPage = await signedInPage(browser, officer.email)
  await decide(officerPage, applicant.nickname, 'Отклонить')
  await expect(officerPage.getByText('Заявка отклонена офицером')).toBeVisible()
  await officerPage.context().close()

  await signInUi(page, applicant.email)
  await expectSignedIn(page)
  await expect(
    page.getByRole('heading', { name: 'Заявка отклонена' }),
  ).toBeVisible()
  await expectInternalMenu(page, false)

  // Вторая вкладка той же сессии открывает форму до подачи из первой.
  const second = await page.context().newPage()
  await second.goto('./#/account/application')
  await expect(second.getByText('Данные из профиля')).toBeVisible({
    timeout: 15_000,
  })

  await page.getByRole('link', { name: 'Подать новую заявку' }).click()
  await expect(page.getByText('Данные из профиля')).toBeVisible()
  expect(await hasHorizontalScroll(page)).toBe(false)
  // Ссылки прежней заявки не переносятся (Q-37).
  await expect(page.getByLabel('Ссылка 1')).toHaveCount(0)
  await page.getByRole('button', { name: 'Добавить ссылку' }).click()
  await page.getByLabel('Ссылка 1').fill('https://example.com/new-gear.png')
  await page.getByRole('button', { name: 'Подать заявку' }).click()
  await expect(page).toHaveURL(/#\/$/, { timeout: 15_000 })
  await expect(
    page.getByRole('heading', { name: 'Заявка отправлена' }),
  ).toBeVisible()

  await second.getByRole('button', { name: 'Подать заявку' }).click()
  await expect(second.getByText('Заявка уже подана')).toBeVisible()
  await expect(second).toHaveURL(/#\/account/)

  const applications = await sql(
    (db) => db<{ status: string }[]>`select status from app.join_applications
      where applicant_id = ${applicant.id} order by created_at`,
  )
  expect(applications.map((row) => row.status)).toEqual([
    'officer_rejected',
    'pending_officer_review',
  ])
  expect(await auditActions(applicant.id)).toEqual([
    'registration_completed',
    'application_rejected',
    'application_resubmitted',
  ])
})
