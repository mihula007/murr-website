import { expect, test, type Page } from '@playwright/test'
import { hasHorizontalScroll, skipSplash } from './helpers'
import { createMember, expectSignedIn, signInUi, sql } from './supabase'

test.skip(
  ({ baseURL }) => Boolean(baseURL?.includes('/repository/')),
  'Сценарий состава проверяется на корневом пути',
)

test.beforeEach(async ({ page }) => {
  test.setTimeout(120_000)
  await skipSplash(page)
})

async function openDynamics(page: Page, nickname?: string) {
  await page.goto('./#/roster')
  if (nickname) {
    await page
      .getByRole('heading', { name: nickname })
      .locator('xpath=../../../')
      .getByRole('button', { name: 'Динамика развития' })
      .click()
  } else {
    await page
      .getByRole('button', { name: 'Динамика развития' })
      .first()
      .click()
  }
  const dialog = page.getByRole('dialog')
  await expect(
    dialog.getByRole('heading', { name: 'Динамика развития' }),
  ).toBeVisible()
  return dialog
}

test('участник видит историю характеристик и недельные посещения на телефоне', async ({
  page,
}) => {
  const member = await createMember('member')
  await sql(async (db) => {
    const [profile] = await db<{ class_id: number }[]>`
      select class_id from app.profiles where id = ${member.id}
    `
    await db`insert into app.character_stat_history
      (user_id, field, value, recorded_at, kind)
      values
        (${member.id}, 'pa', 120, '2026-11-06T20:59:00Z', 'baseline'),
        (${member.id}, 'pa', 145, '2026-11-20T20:59:00Z', 'checkpoint'),
        (${member.id}, 'pz', 80, '2026-11-06T20:59:00Z', 'baseline'),
        (${member.id}, 'pz', 100, '2026-11-20T20:59:00Z', 'checkpoint')`
    const events = [
      {
        id: crypto.randomUUID(),
        status: 'visited',
        date: '2026-11-20T17:00:00Z',
      },
      {
        id: crypto.randomUUID(),
        status: 'missed',
        date: '2026-11-13T17:00:00Z',
      },
      {
        id: crypto.randomUUID(),
        status: 'unmarked',
        date: '2026-11-06T17:00:00Z',
      },
    ]
    for (const event of events) {
      await db`insert into app.events
        (id, title, event_type, description, starts_at, closed_at)
        values (${event.id}, 'Проверка динамики', 'clan', 'Тест', ${event.date}, ${event.date})`
      await db`insert into app.event_activity_records
        (event_id, user_id, nickname, class_id, status, group_name, is_leader)
        values (${event.id}, ${member.id}, ${member.nickname}, ${profile!.class_id}, ${event.status}, ${event.status === 'visited' ? 'Пати' : null}, false)`
    }
  })
  await signInUi(page, member.email)
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
  const admin = await createMember('admin')
  await sql(
    (db) =>
      db`update app.profiles set joined_on = '2026-01-01' where id = ${admin.id}`,
  )
  await signInUi(page, admin.email)
  await expectSignedIn(page)
  const dialog = await openDynamics(page, admin.nickname)
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
