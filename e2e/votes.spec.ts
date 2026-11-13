import { expect, test, type Browser, type Page } from '@playwright/test'
import {
  expectInternalMenu,
  hasHorizontalScroll,
  scrollUntilVisible,
  skipSplash,
} from './helpers'
import {
  accessToken,
  auditActions,
  callApi,
  createMember,
  expectSignedIn,
  registerApplicant,
  signInUi,
  sql,
} from './supabase'

test.skip(
  ({ baseURL }) => Boolean(baseURL?.includes('/repository/')),
  'Сценарии голосований проверяются на корневом пути',
)

test.beforeEach(async ({ page }) => {
  // Регистрация через Auth и Mailpit, несколько пользователей и вызовов.
  test.setTimeout(180_000)
  await skipSplash(page)
})

/** Отдельный браузерный контекст — пользователь со своей сессией. */
async function signedInPage(browser: Browser, email: string) {
  const context = await browser.newContext({
    ...test.info().project.use,
  })
  const page = await context.newPage()
  await skipSplash(page)
  await signInUi(page, email)
  await expectSignedIn(page)
  return page
}

/** Подтверждение в диалоге действия кнопкой с тем же или другим названием. */
async function confirm(page: Page, label: string) {
  const dialog = page.getByRole('alertdialog')
  await dialog.getByRole('button', { name: label, exact: true }).click()
  await expect(dialog).toBeHidden()
}

/** Управление голосованием — в меню «⋯» карточки. */
async function manageVote(page: Page, action: string) {
  await page.getByRole('button', { name: /^Управление голосованием/ }).click()
  await page.getByRole('menuitem', { name: action, exact: true }).click()
}

async function openVote(page: Page, title: string) {
  await page.goto('./#/votes')
  await page.getByRole('link', { name: title }).click()
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
}

async function choose(page: Page, label: string) {
  await page.getByRole('button', { name: label, exact: true }).click()
  await expect(page.getByText('Ваше решение:')).toBeVisible()
}

test('E2E-01: вступление через голосование и решение администратора', async ({
  page,
  browser,
}) => {
  const applicant = await registerApplicant()
  const [officer, admin, member] = await Promise.all([
    createMember('officer'),
    createMember('admin'),
    createMember('member'),
  ])
  const title = `Заявка: ${applicant.nickname}`

  // Офицер передаёт заявку на голосование.
  const officerPage = await signedInPage(browser, officer.email)
  await officerPage.goto('./#/applications')
  await officerPage
    .getByRole('link', { name: new RegExp(applicant.nickname) })
    .click()
  await officerPage
    .getByRole('button', { name: 'Передать на голосование' })
    .click()
  await confirm(officerPage, 'Передать')
  await expect(officerPage.getByText('На голосовании гильдии')).toBeVisible()
  await officerPage.getByRole('link', { name: 'Открыть голосование' }).click()
  await expect(
    officerPage.getByText(`Кандидат: ${applicant.nickname} · Маг`),
  ).toBeVisible()
  expect(await hasHorizontalScroll(officerPage)).toBe(false)
  await choose(officerPage, 'За')

  // Член клана голосует и меняет решение: итог не растёт (VOT-05, VOT-06).
  const memberPage = await signedInPage(browser, member.email)
  await openVote(memberPage, title)
  await choose(memberPage, 'Против')
  await memberPage.getByRole('button', { name: 'Изменить решение' }).click()
  await choose(memberPage, 'За')
  await expect(memberPage.getByText(/^Голосов: 2/)).toBeVisible()
  // Члену не показываются голоса участников (VOT-07).
  await expect(memberPage.getByText('Кто как голосовал')).toHaveCount(0)
  await memberPage.context().close()

  // Офицер видит, кто как голосовал, и завершает.
  await officerPage.reload()
  await expect(
    officerPage
      .getByRole('list', { name: 'Голоса участников' })
      .getByText(member.nickname),
  ).toBeVisible()
  await manageVote(officerPage, 'Завершить')
  await confirm(officerPage, 'Завершить')
  await expect(
    officerPage.getByText('Голосование завершено: решение изменить нельзя.'),
  ).toBeVisible()

  // Большинство «За» не принимает кандидата; офицер окончательно не решает.
  await officerPage
    .getByRole('link', { name: 'Открыть заявку кандидата' })
    .click()
  await expect(
    officerPage.getByText('Ожидает решения администрации'),
  ).toBeVisible()
  await expect(
    officerPage.getByRole('button', { name: 'Принять', exact: true }),
  ).toHaveCount(0)
  await officerPage.context().close()

  // Кандидат видит этап ожидания администрации, но не итоги.
  await signInUi(page, applicant.email)
  await expectSignedIn(page)
  await expect(
    page.getByRole('heading', { name: 'Голосование завершено' }),
  ).toBeVisible()
  await expectInternalMenu(page, false)

  // Администратор принимает из очереди окончательных решений.
  const adminPage = await signedInPage(browser, admin.email)
  await adminPage.goto('./#/applications?tab=final')
  const queue = adminPage.getByRole('list', { name: 'Окончательные решения' })
  await expect(queue.getByText(/За: 2 · Против: 0/).first()).toBeVisible()
  await queue
    .getByRole('link', { name: new RegExp(applicant.nickname) })
    .click()
  expect(await hasHorizontalScroll(adminPage)).toBe(false)
  await adminPage.getByRole('button', { name: 'Принять', exact: true }).click()
  await confirm(adminPage, 'Принять')
  await expect(
    adminPage.getByText('Администрация подтвердила приём'),
  ).toBeVisible()
  await adminPage.context().close()

  // Кандидат получает внутренний доступ и появляется в составе.
  await page.reload()
  await expectInternalMenu(page, true)
  await page.goto('./#/roster')
  // Состав виртуализирован: участник может быть ниже первого экрана.
  await scrollUntilVisible(
    page,
    page.getByRole('heading', { name: applicant.nickname }),
  )

  expect(await auditActions(applicant.id)).toEqual([
    'registration_completed',
    'application_submitted_to_vote',
    'application_accepted_final',
  ])
})

test('обычное голосование: создание, правка, завершение и история', async ({
  page,
  browser,
}) => {
  const [officer, member] = await Promise.all([
    createMember('officer'),
    createMember('member'),
  ])
  const title = `Рейд ${Date.now()}`

  await signInUi(page, officer.email)
  await expectSignedIn(page)
  await page.goto('./#/votes')
  await page.getByRole('link', { name: /Создать голосование/ }).click()
  const form = page.getByRole('form', { name: 'Новое голосование' })
  await form.getByLabel('Тема').fill(title)
  await form.getByLabel('Вариант 1', { exact: true }).fill('Да')
  await form.getByLabel('Вариант 2', { exact: true }).fill('да')
  await form.getByRole('button', { name: 'Создать голосование' }).click()
  await expect(form.getByText('Такое значение уже есть')).toBeVisible()
  await form.getByLabel('Вариант 2', { exact: true }).fill('Нет')
  await form.getByRole('button', { name: /Добавить вариант/ }).click()
  await form.getByLabel('Вариант 3', { exact: true }).fill('Позже')
  expect(await hasHorizontalScroll(page)).toBe(false)
  await form.getByRole('button', { name: 'Создать голосование' }).click()
  await expect(page.getByRole('heading', { name: title })).toBeVisible()

  const memberPage = await signedInPage(browser, member.email)
  await openVote(memberPage, title)
  await choose(memberPage, 'Позже')
  // Член клана не управляет голосованием.
  await expect(
    memberPage.getByRole('button', { name: /^Управление голосованием/ }),
  ).toHaveCount(0)

  // Правка темы сохраняет голоса (VOT-08).
  const renamed = `${title} (изм.)`
  await page.reload()
  await manageVote(page, 'Изменить')
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Тема').fill(renamed)
  await dialog.getByRole('button', { name: 'Сохранить' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('heading', { name: renamed })).toBeVisible()
  await expect(page.getByText(/^Голосов: 1/)).toBeVisible()

  await manageVote(page, 'Завершить')
  await confirm(page, 'Завершить')

  // В истории — итоги и свой голос, без кнопок голоса и управления (VOT-12);
  // остаётся только обсуждение для чтения (DSC-13).
  await memberPage.goto('./#/votes?tab=history')
  const card = memberPage.getByRole('listitem').filter({ hasText: renamed })
  await expect(card.getByText('ваш выбор')).toBeVisible()
  await expect(card.getByRole('button')).toHaveCount(1)
  await expect(card.getByRole('button')).toHaveText(/^Обсуждение \(\d+\)$/)
  expect(await hasHorizontalScroll(memberPage)).toBe(false)
  await memberPage.context().close()
})

test('удаление активного голосования возвращает заявку в очередь', async ({
  page,
}) => {
  const applicant = await registerApplicant()
  const officer = await createMember('officer')

  await signInUi(page, officer.email)
  await expectSignedIn(page)
  await page.goto('./#/applications')
  await page.getByRole('link', { name: new RegExp(applicant.nickname) }).click()
  await page.getByRole('button', { name: 'Передать на голосование' }).click()
  await confirm(page, 'Передать')
  await page.getByRole('link', { name: 'Открыть голосование' }).click()
  await manageVote(page, 'Удалить')
  await confirm(page, 'Удалить')
  await expect(page).toHaveURL(/#\/votes/)

  await page.goto('./#/applications')
  await expect(
    page
      .getByRole('list', { name: 'Новые заявки' })
      .getByRole('link', { name: new RegExp(applicant.nickname) }),
  ).toBeVisible()
  const [row] = await sql(
    (db) => db<{ status: string }[]>`select status from app.join_applications
      where applicant_id = ${applicant.id}`,
  )
  expect(row?.status).toBe('pending_officer_review')
})

test('прямые запрещённые вызовы голосований отклоняются', async () => {
  test.skip(
    test.info().project.name !== 'chromium',
    'Прямые вызовы API не зависят от устройства',
  )
  const applicant = await registerApplicant()
  const [member, officer] = await Promise.all([
    createMember('member'),
    createMember('officer'),
  ])
  const [applicantToken, memberToken, officerToken] = await Promise.all([
    accessToken(applicant.email),
    accessToken(member.email),
    accessToken(officer.email),
  ])
  const vote = { title: 'Тест', options: ['А', 'Б'] }
  expect((await callApi('votes/create', memberToken, vote)).status).toBe(403)
  expect(
    (await callApi('votes/list', applicantToken, { tab: 'active' })).status,
  ).toBe(403)
  const [application] = await sql(
    (db) => db<{ id: string }[]>`select id from app.join_applications
      where applicant_id = ${applicant.id}`,
  )
  const id = application!.id
  expect(
    (await callApi('applications/submit-to-vote', memberToken, { id })).status,
  ).toBe(403)
  expect(
    (await callApi('applications/submit-to-vote', officerToken, { id })).status,
  ).toBe(200)
  expect(
    (
      await callApi('applications/final-decide', officerToken, {
        id,
        decision: 'accept',
      })
    ).status,
  ).toBe(403)
  const created = await callApi('votes/create', officerToken, vote)
  const detail = await callApi('votes/get', memberToken, {
    id: created.body.id,
  })
  expect(detail.status).toBe(200)
  expect(detail.body).not.toHaveProperty('ballots')
})
