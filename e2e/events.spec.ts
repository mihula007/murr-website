import { expect, test, type Browser, type Page } from '@playwright/test'
import { hasHorizontalScroll, skipSplash } from './helpers'
import {
  accessToken,
  callApi,
  createMember,
  expectSignedIn,
  localStack,
  registerApplicant,
  signInUi,
  sql,
} from './supabase'

test.skip(
  ({ baseURL }) => Boolean(baseURL?.includes('/repository/')),
  'Сценарии событий проверяются на корневом пути',
)

test.beforeEach(async ({ page }) => {
  // Несколько пользователей, сессий и вызовов функции на слабой машине.
  test.setTimeout(180_000)
  await skipSplash(page)
})

/** Дата по Москве через `days` дней, `YYYY-MM-DD` (Q-44). */
function moscowDate(days = 0) {
  return new Date(Date.now() + (3 + 24 * days) * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
}

/** Отдельный браузерный контекст — пользователь со своей сессией. */
async function signedInPage(browser: Browser, email: string) {
  const context = await browser.newContext({ ...test.info().project.use })
  const page = await context.newPage()
  await skipSplash(page)
  await signInUi(page, email)
  await expectSignedIn(page)
  return page
}

async function eventId(title: string) {
  const [row] = await sql(
    (db) =>
      db<{ id: string }[]>`select id from app.events where title = ${title}`,
  )
  return row?.id
}

async function answerCount(id: string) {
  const [row] = await sql(
    (db) => db<{ count: number }[]>`select count(*)::int as count
      from app.event_attendance where event_id = ${id}`,
  )
  return row?.count ?? 0
}

/** Счётчик ответа в карточке события. */
function count(page: Page, label: string) {
  return page
    .getByRole('list', { name: 'Ответы участников' })
    .getByRole('listitem')
    .filter({ hasText: new RegExp(`^${label}:`) })
}

async function choose(page: Page, label: string) {
  await page.getByRole('button', { name: label, exact: true }).click()
  await expect(page.getByText('Ваше решение:')).toBeVisible()
}

test('событие: создание, правка, ответы и удаление', async ({
  page,
  browser,
}) => {
  const [officer, member] = await Promise.all([
    createMember('officer'),
    createMember('member'),
  ])
  const title = `E2E ${Date.now()}`

  await signInUi(page, officer.email)
  await expectSignedIn(page)
  await page.goto('./#/events')
  await page.getByRole('link', { name: /Создать ивент/ }).click()
  const form = page.getByRole('form', { name: 'Новое событие' })
  await form.getByRole('button', { name: 'Создать ивент' }).click()
  await expect(form.getByText('Заполните поле').first()).toBeVisible()
  await form.getByLabel('Название').fill(title)
  await form.getByLabel('Дата (МСК)').fill(moscowDate(2))
  await form.getByLabel('Время (МСК)').fill('21:30')
  await form.getByLabel('Описание').fill('Сбор у портала')
  expect(await hasHorizontalScroll(page)).toBe(false)
  await form.getByRole('button', { name: 'Создать ивент' }).click()
  await expect(page).toHaveURL(/#\/events\?tab=active/)
  const id = await eventId(title)
  expect(id).toBeTruthy()

  // Правка сохраняет тот же объект и его ответы (приёмка 1).
  await page.goto(`./#/events/${id}`)
  await expect(page.getByText(/, 21:30 МСК$/)).toBeVisible()
  await choose(page, 'Приду')
  await page.getByRole('link', { name: 'Редактировать' }).click()
  const edit = page.getByRole('form', { name: 'Редактирование события' })
  await expect(edit.getByLabel('Название')).toHaveValue(title)
  await edit.getByLabel('Описание').fill('Сбор у ворот')
  await edit.getByRole('button', { name: 'Сохранить изменения' }).click()
  await expect(page).toHaveURL(new RegExp(`#/events/${id}$`))
  await expect(page.getByText('Сбор у ворот')).toBeVisible()
  await expect(count(page, 'Приду')).toHaveText('Приду: 1')

  // Ответ и смена ответа — одна строка участника (приёмка 2).
  const memberPage = await signedInPage(browser, member.email)
  await memberPage.goto(`./#/events/${id}`)
  await choose(memberPage, 'Приду')
  await expect(count(memberPage, 'Приду')).toHaveText('Приду: 2')
  await memberPage.getByRole('button', { name: 'Изменить решение' }).click()
  await choose(memberPage, '50/50')
  await expect(count(memberPage, 'Приду')).toHaveText('Приду: 1')
  await expect(count(memberPage, '50/50')).toHaveText('50/50: 1')
  expect(await answerCount(id!)).toBe(2)
  // Член клана не управляет событием.
  await expect(
    memberPage.getByRole('link', { name: 'Редактировать' }),
  ).toHaveCount(0)
  await expect(memberPage.getByRole('button', { name: 'Удалить' })).toHaveCount(
    0,
  )
  expect(await hasHorizontalScroll(memberPage)).toBe(false)
  await memberPage.context().close()

  // Удаление: отказ сохраняет, согласие удаляет с ответами (приёмка 5).
  await page.reload()
  await page.getByRole('button', { name: 'Удалить' }).click()
  const dialog = page.getByRole('alertdialog')
  await dialog.getByRole('button', { name: 'Отмена' }).click()
  await expect(dialog).toBeHidden()
  expect(await eventId(title)).toBe(id)
  await page.getByRole('button', { name: 'Удалить' }).click()
  await dialog.getByRole('button', { name: 'Удалить', exact: true }).click()
  await expect(page).toHaveURL(/#\/events\?tab=active/)
  expect(await eventId(title)).toBeUndefined()
  expect(await answerCount(id!)).toBe(0)
})

test('шаблон заполняет ближайшую дату и не создаёт событие', async ({
  page,
}) => {
  const officer = await createMember('officer')
  // Шаблоны прошлых прогонов не должны упереться в лимит 50.
  await sql(
    (db) => db`delete from app.event_templates
      where title like 'E2E шаблон %' and created_at < now() - interval '1 hour'`,
  )
  const title = `E2E шаблон ${Date.now()}`

  await signInUi(page, officer.email)
  await expectSignedIn(page)
  await page.goto('./#/events/new')
  const form = page.getByRole('form', { name: 'Новое событие' })
  await form.getByLabel('Название').fill(title)
  // Сегодня в 00:00 МСК уже прошло: ближайшая дата — через неделю (EVT-12).
  await form.getByLabel('Дата (МСК)').fill(moscowDate())
  await form.getByLabel('Время (МСК)').fill('00:00')
  await form.getByLabel('Описание').fill('Еженедельный сбор')
  await page.getByRole('button', { name: 'Сохранить как шаблон' }).click()
  const card = page
    .getByRole('list', { name: 'Шаблоны событий' })
    .getByRole('listitem')
    .filter({ hasText: title })
  await expect(card).toBeVisible()
  expect(await eventId(title)).toBeUndefined()

  await form.getByLabel('Дата (МСК)').fill('')
  await card.getByRole('button', { name: 'Заполнить ближайшую дату' }).click()
  await expect(form.getByLabel('Дата (МСК)')).toHaveValue(moscowDate(7))
  await expect(form.getByLabel('Время (МСК)')).toHaveValue('00:00')
  expect(await eventId(title)).toBeUndefined()
  expect(await hasHorizontalScroll(page)).toBe(false)

  await card.getByRole('button', { name: 'Удалить' }).click()
  const dialog = page.getByRole('alertdialog')
  await dialog.getByRole('button', { name: 'Удалить', exact: true }).click()
  await expect(card).toHaveCount(0)
})

test('запасная кнопка не создаёт дубликатов постоянных событий', async ({
  page,
}) => {
  const officer = await createMember('officer')
  await signInUi(page, officer.email)
  await expectSignedIn(page)
  await page.goto('./#/events')
  const button = page.getByRole('button', {
    name: /Создать постоянные события недели/,
  })
  await button.click()
  await expect(button).toBeEnabled()
  await button.click()
  await expect(button).toBeEnabled()
  const rows = await sql(
    (db) => db<{ recurring_preset: string; count: number }[]>`
      select recurring_preset, count(*)::int as count from app.events
      where recurring_preset is not null and starts_at > now()
      group by recurring_preset, starts_at`,
  )
  expect(rows.length).toBeGreaterThanOrEqual(4)
  expect(rows.every((row) => row.count === 1)).toBe(true)
  await expect(page.getByText('Автор: Автоматически').first()).toBeVisible()
  expect(await hasHorizontalScroll(page)).toBe(false)
})

test('после начала события ответы закрыты', async ({ page }) => {
  const [officer, member] = await Promise.all([
    createMember('officer'),
    createMember('member'),
  ])
  const title = `E2E начато ${Date.now()}`
  const [row] = await sql(
    (db) => db<{ id: string }[]>`insert into app.events
      (title, event_type, description, starts_at, created_by)
      values (${title}, 'pvp', 'Уже идёт', now() - interval '1 hour', ${officer.id})
      returning id`,
  )
  await signInUi(page, member.email)
  await expectSignedIn(page)
  await page.goto(`./#/events/${row!.id}`)
  await expect(
    page.getByText(/Событие началось: ответы больше не принимаются/),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Приду' })).toHaveCount(0)
  const response = await callApi(
    'events/respond',
    await accessToken(member.email),
    { eventId: row!.id, answer: 'yes' },
  )
  expect(response.status).toBe(409)
})

test('прямые запрещённые вызовы событий отклоняются', async () => {
  test.skip(
    test.info().project.name !== 'chromium',
    'Прямые вызовы API не зависят от устройства',
  )
  const applicant = await registerApplicant()
  const [member, author, other] = await Promise.all([
    createMember('member'),
    createMember('officer'),
    createMember('officer'),
  ])
  const [applicantToken, memberToken, authorToken, otherToken] =
    await Promise.all([
      accessToken(applicant.email),
      accessToken(member.email),
      accessToken(author.email),
      accessToken(other.email),
    ])
  const fields = {
    title: `E2E права ${Date.now()}`,
    type: 'pve',
    date: moscowDate(3),
    time: '20:00',
    description: 'Проверка прав',
  }
  expect((await callApi('events/create', memberToken, fields)).status).toBe(403)
  expect(
    (await callApi('events/list', applicantToken, { tab: 'active' })).status,
  ).toBe(403)
  const created = await callApi('events/create', authorToken, fields)
  expect(created.status).toBe(200)
  const id = created.body.id as string
  expect(
    (await callApi('events/update', otherToken, { id, ...fields })).status,
  ).toBe(403)
  expect((await callApi('events/delete', otherToken, { id })).status).toBe(403)
  const detail = await callApi('events/get', memberToken, { id })
  expect(detail.status).toBe(200)
  expect(JSON.stringify(detail.body)).not.toContain('@example.test')

  // Вызов расписания с чужим секретом не проходит.
  const { API_URL, ANON_KEY } = localStack()
  const schedule = await fetch(
    `${API_URL}/functions/v1/api/events/ensure-weekly`,
    {
      method: 'POST',
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
        'Content-Type': 'application/json',
        'x-cron-secret': 'not-the-secret',
      },
      body: '{}',
    },
  )
  expect(schedule.status).toBe(403)
  await callApi('events/delete', authorToken, { id })
})
