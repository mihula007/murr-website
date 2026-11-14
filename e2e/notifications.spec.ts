import { expect, test, type Browser, type Page } from '@playwright/test'
import { hasHorizontalScroll, skipSplash } from './helpers'
import {
  accessToken,
  callApi,
  createMember,
  expectSignedIn,
  registerApplicant,
  signInUi,
  sql,
} from './supabase'

test.skip(
  ({ baseURL }) => Boolean(baseURL?.includes('/repository/')),
  'Сценарии уведомлений проверяются на корневом пути',
)

test.beforeEach(async ({ page }) => {
  test.setTimeout(180_000)
  await skipSplash(page)
})

type Person = { id: string; email: string; nickname: string }

async function signedInPage(browser: Browser, email: string) {
  const context = await browser.newContext({ ...test.info().project.use })
  const page = await context.newPage()
  await skipSplash(page)
  await signInUi(page, email)
  await expectSignedIn(page)
  return page
}

function moscowDate(days: number) {
  return new Date(Date.now() + (3 + 24 * days) * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
}

async function createEvent(officer: Person, title: string) {
  const created = await callApi(
    'events/create',
    await accessToken(officer.email),
    {
      title,
      type: 'pve',
      date: moscowDate(3),
      time: '20:00',
      description: 'Проверка уведомлений',
    },
  )
  expect(created.status).toBe(200)
  return created.body.id as string
}

const bell = (page: Page) =>
  page.getByRole('banner').getByRole('button', { name: /^Уведомления/ })

const panel = (page: Page) => page.getByRole('dialog', { name: 'Уведомления' })

async function notificationCount(recipientId: string) {
  const [row] = await sql(
    (db) => db<{ count: string }[]>`select count(*) from app.user_notifications
      where recipient_id = ${recipientId}`,
  )
  return Number(row?.count)
}

test('приёмка NTF 1–2: одно уведомление о приёме, прочтение одного и всех', async ({
  page,
}) => {
  const [admin, applicant] = await Promise.all([
    createMember('admin'),
    registerApplicant(),
  ])
  const [application] = await sql(
    (db) => db<{ id: string }[]>`select id from app.join_applications
      where applicant_id = ${applicant.id}`,
  )
  const decided = await callApi(
    'applications/decide',
    await accessToken(admin.email),
    { id: application!.id, decision: 'accept' },
  )
  expect(decided.status).toBe(200)
  expect(await notificationCount(applicant.id)).toBe(1)
  expect(await notificationCount(admin.id)).toBe(0)

  await signInUi(page, applicant.email)
  await expectSignedIn(page)
  await expect(bell(page)).toHaveAccessibleName('Уведомления, непрочитанных: 1')
  await bell(page).click()
  const item = panel(page).getByRole('button', { name: /заявк/i })
  await expect(item).toBeVisible()
  // Открытие панели ничего не прочитывает (NTF-05).
  await expect(bell(page)).toHaveAccessibleName('Уведомления, непрочитанных: 1')
  expect(await hasHorizontalScroll(page)).toBe(false)
  await item.click()
  await expect(page).toHaveURL(/#\/account$/)
  await expect(bell(page)).toHaveAccessibleName('Уведомления')

  await sql(
    (db) => db`insert into app.user_notifications
      (recipient_id, kind, title, source_kind, source_id)
      values (${applicant.id}, 'discussion_mention', 'Упоминание 1', 'e2e', '1'),
        (${applicant.id}, 'discussion_mention', 'Упоминание 2', 'e2e', '2')`,
  )
  await page.reload()
  await expect(bell(page)).toHaveAccessibleName('Уведомления, непрочитанных: 2')
  await bell(page).click()
  await panel(page).getByRole('button', { name: 'Прочитать все' }).click()
  await expect(bell(page)).toHaveAccessibleName('Уведомления')
  // Непрочитанных не осталось — кнопка скрыта.
  await expect(
    panel(page).getByRole('button', { name: 'Прочитать все' }),
  ).toHaveCount(0)
  await expect(
    panel(page).getByRole('button', { name: /Упоминание 2/ }),
  ).toBeVisible()
})

test('приёмка NTF 3: счётчик раздела отделён от колокольчика и снимается посещением', async ({
  page,
  browser,
  isMobile,
}) => {
  const [officer, member] = await Promise.all([
    createMember('officer'),
    createMember('member'),
  ])
  await signInUi(page, member.email)
  await expectSignedIn(page)
  // Первая сводка ставит отметки просмотра: новый участник начинает с нуля.
  await expect(bell(page)).toHaveAccessibleName('Уведомления')

  const officerPage = await signedInPage(browser, officer.email)
  await createEvent(officer, `E2E новизна ${Date.now()}`)
  await officerPage.close()

  await page.reload()
  const trigger = isMobile
    ? page.getByRole('banner').getByRole('button', { name: 'Открыть меню' })
    : page.getByRole('banner').getByRole('button', { name: /^Клан/ })
  // На категории и кнопке меню — точка «есть новое», число — у раздела.
  await expect(trigger.getByText('есть новое')).toHaveCount(1)
  await expect(bell(page)).toHaveAccessibleName('Уведомления')

  await page.goto('./#/events')
  await expect(trigger.getByText('есть новое')).toHaveCount(0)
  const summary = await callApi(
    'notifications/summary',
    await accessToken(member.email),
  )
  expect(summary.body.sections).toMatchObject({ events: 0 })
})

test('приёмка NTF 4: переход к событию и к удалённому событию', async ({
  page,
}) => {
  const [officer, member] = await Promise.all([
    createMember('officer'),
    createMember('member'),
  ])
  const token = await accessToken(officer.email)
  const kept = `E2E группа ${Date.now()}`
  const keptId = await createEvent(officer, kept)
  const gone = `E2E удалено ${Date.now()}`
  const goneId = await createEvent(officer, gone)
  for (const eventId of [keptId, goneId]) {
    const group = await callApi('groups/create', token, {
      eventId,
      name: 'Пати 1',
    })
    const groups = group.body.groups as { id: string }[]
    const moved = await callApi('groups/move', token, {
      eventId,
      userId: member.id,
      groupId: groups[0]!.id,
    })
    expect(moved.status).toBe(200)
  }
  expect((await callApi('events/delete', token, { id: goneId })).status).toBe(
    200,
  )

  await signInUi(page, member.email)
  await expectSignedIn(page)
  await expect(bell(page)).toHaveAccessibleName('Уведомления, непрочитанных: 2')
  await bell(page).click()
  await panel(page)
    .getByRole('button', { name: new RegExp(`${kept} · Пати 1`) })
    .click()
  await expect(page).toHaveURL(new RegExp(`#/events/${keptId}$`))
  await expect(page.getByRole('heading', { name: kept })).toBeVisible()

  await bell(page).click()
  await panel(page)
    .getByRole('button', { name: new RegExp(`${gone} · Пати 1`) })
    .click()
  await expect(page).toHaveURL(new RegExp(`#/events/${goneId}$`))
  await expect(page.getByText('Событие не найдено')).toBeVisible()
  await expect(bell(page)).toHaveAccessibleName('Уведомления')
})

test('главная по ролям: ответ с главной виден в расписании (HOM-07–09)', async ({
  page,
  browser,
}) => {
  const [officer, member, applicant] = await Promise.all([
    createMember('officer'),
    createMember('member'),
    createMember('applicant'),
  ])
  await createEvent(officer, `E2E главная ${Date.now()}`)

  await signInUi(page, member.email)
  await expectSignedIn(page)
  await page.goto('./#/')
  const upcoming = page.getByRole('region', { name: 'Ближайшее событие' })
  await expect(upcoming).toBeVisible()
  await expect(
    page.getByRole('region', { name: 'Топ-5 посещаемости за месяц' }),
  ).toBeVisible()
  await expect(page.getByRole('link', { name: /Весь учёт/ })).toHaveCount(0)
  await expect(
    page.getByRole('heading', { name: 'Состав клана' }),
  ).toBeVisible()
  expect(await hasHorizontalScroll(page)).toBe(false)

  // Ответ в главном событии — тот же ответ в расписании (HOM-08).
  // Начавшиеся события ответа не принимают и идут первыми; локальная БД копит
  // их от прогона к прогону, поэтому выбора может не быть.
  // Общий запрос главной и расписания проверяет `tests/home.test.tsx`.
  const choices = upcoming.getByRole('group', { name: 'Ваше решение' })
  if ((await choices.count()) === 0) {
    test.info().annotations.push({
      type: 'skip-part',
      description: 'HOM-08: ближайшее событие уже не принимает ответ',
    })
  } else {
    const href = await upcoming
      .getByRole('heading', { level: 1 })
      .getByRole('link')
      .getAttribute('href')
    await upcoming.getByRole('button', { name: 'Приду', exact: true }).click()
    // Группа выбора после ответа исчезает; новый участник ответил только здесь.
    await expect(upcoming.getByText('Ваше решение:')).toHaveCount(1)
    await page.goto(`./${href}`)
    await expect(page.getByText('Ваше решение:')).toBeVisible()
  }

  const officerPage = await signedInPage(browser, officer.email)
  await officerPage.goto('./#/')
  await expect(
    officerPage.getByRole('link', { name: /Весь учёт/ }),
  ).toBeVisible()
  await officerPage.close()

  const applicantPage = await signedInPage(browser, applicant.email)
  await applicantPage.goto('./#/')
  await expect(
    applicantPage.getByRole('heading', { name: /Легенда продолжается/ }),
  ).toBeVisible()
  await expect(
    applicantPage.getByRole('region', { name: 'Ближайшее событие' }),
  ).toHaveCount(0)
  await expect(
    applicantPage.getByRole('heading', { name: 'Состав клана' }),
  ).toHaveCount(0)
  await expect(bell(applicantPage)).toBeVisible()
  await applicantPage.close()
})
