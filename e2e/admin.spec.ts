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
  'Сценарии администрирования проверяются на корневом пути',
)

test.beforeEach(async ({ page }) => {
  test.setTimeout(180_000)
  await skipSplash(page)
})

function moscowDate(days = 0) {
  return new Date(Date.now() + (3 + 24 * days) * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
}

test('ADM: поиск, карточка, журнал и безвозвратное удаление', async ({
  page,
}) => {
  const [admin, officer, target] = await Promise.all([
    createMember('admin'),
    createMember('officer'),
    createMember('officer'),
  ])
  // Событие удаляемого автора остаётся с подписью «Пользователь удалён».
  const title = `E2E удаление ${Date.now()}`
  const created = await callApi(
    'events/create',
    await accessToken(target.email),
    {
      title,
      type: 'pve',
      date: moscowDate(3),
      time: '20:00',
      description: 'Событие удаляемого автора',
    },
  )
  expect(created.status).toBe(200)

  // Офицер не удаляет аккаунты и не читает журнал (ACL-03).
  const officerToken = await accessToken(officer.email)
  expect(
    (
      await callApi('accounts/delete', officerToken, {
        userId: target.id,
        confirmNickname: target.nickname,
      })
    ).status,
  ).toBe(403)
  expect((await callApi('audit/list', officerToken)).status).toBe(403)

  await signInUi(page, admin.email)
  await expectSignedIn(page)
  await page.goto('./#/admin')

  // Поиск и карточка (ADM-02, ADM-03).
  await page
    .getByLabel('Поиск по нику, имени, email и классу')
    .fill(target.nickname)
  await expect(page.getByText('Аккаунтов: 1', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Карточка' }).click()
  const card = page.getByRole('dialog', { name: 'Карточка аккаунта' })
  await expect(card.getByText(target.email)).toBeVisible()
  await expect(card.getByText('Москва')).toBeVisible()
  await page.keyboard.press('Escape')
  expect(await hasHorizontalScroll(page)).toBe(false)

  // Удаление с подтверждением ником (Q-73).
  await page
    .getByRole('button', { name: `Действия с ${target.nickname}` })
    .click()
  await page.getByRole('menuitem', { name: 'Удалить навсегда' }).click()
  const dialog = page.getByRole('dialog')
  await dialog
    .getByLabel(`Введите ник «${target.nickname}» для подтверждения`)
    .fill(target.nickname)
  await dialog.getByRole('button', { name: 'Удалить навсегда' }).click()
  await expect(dialog).toBeHidden({ timeout: 30_000 })
  await expect(page.getByText('Аккаунтов: 0', { exact: true })).toBeVisible()

  // Входа больше нет; профиля и служебной записи нет.
  await expect(accessToken(target.email)).rejects.toThrow(
    /Invalid login credentials/,
  )
  const rows = await sql(
    (db) => db<{ count: number }[]>`
      select (select count(*) from app.profiles where id = ${target.id})
        + (select count(*) from app.user_deletions where user_id = ${target.id})
        as count`,
  )
  expect(Number(rows[0]!.count)).toBe(0)

  // Событие сохранилось без автора (EVT-16).
  await page.goto(`./#/events/${created.body.id as string}`)
  await expect(page.getByText('Автор: Пользователь удалён')).toBeVisible()

  // Журнал: запись удаления с ником и email (ADM-10, ADM-11).
  await page.goto('./#/admin?tab=audit')
  await page.getByLabel('Поиск по исполнителю и событию').fill(target.nickname)
  const entry = page
    .getByRole('article')
    .filter({ hasText: 'Безвозвратное удаление пользователя' })
    .filter({ hasText: target.email })
  await expect(entry).toHaveCount(1)
  await expect(entry.getByText(new RegExp(target.nickname))).toBeVisible()
  expect(await hasHorizontalScroll(page)).toBe(false)
})
