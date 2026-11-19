import { expect, test, type Page } from '@playwright/test'
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

async function openFiltersWhenNarrow(page: Page) {
  const button = page.getByRole('button', { name: 'Фильтры' })
  if (await button.isVisible()) {
    await button.click()
  }
}

test('ADM-10: журнал действий прокручивается внутри списка', async ({
  page,
}) => {
  const admin = await createMember('admin')
  const prefix = `Прокрутка журнала ${Date.now()}`
  await sql(
    (db) => db`
      insert into app.audit_log (
        category, action, summary, actor_id, actor_role, actor_nickname, actor_email
      )
      select
        'profiles', 'profile_updated', ${prefix} || ' #' || i::text,
        ${admin.id}::uuid, 'admin', ${admin.nickname}, ${admin.email}
      from generate_series(1, 20) as i
    `,
  )

  try {
    await signInUi(page, admin.email)
    await expectSignedIn(page)
    await page.goto('./#/admin?tab=audit')

    const log = page.getByRole('region', {
      name: 'Прокручиваемый список: Журнал действий',
    })
    await expect(log).toHaveAttribute('data-viewport-rows', '15')
    await expect(page.getByText(`${prefix} #20`)).toBeVisible()
    await log.evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    await expect
      .poll(() => log.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0)
    await expect(page.getByText(`${prefix} #1`)).toBeVisible()
  } finally {
    await sql(
      (db) =>
        db`delete from app.audit_log where summary like ${`${prefix} #%`}`,
    )
  }
})

test('E2E-14: фильтры класса и роли сохраняются на компьютере и телефоне', async ({
  page,
}) => {
  const [admin, member, otherMember, officer] = await Promise.all([
    createMember('admin'),
    createMember('member'),
    createMember('member'),
    createMember('officer'),
  ])
  const classIds = await sql(async (db) => {
    const [classes] = await db<{ mage: number; warrior: number }[]>`
      select
        (select id from app.character_classes where slug = 'mage') as mage,
        (select id from app.character_classes where slug = 'warrior') as warrior
    `
    if (!classes) {
      throw new Error('Не найдены тестовые классы')
    }
    return classes
  })
  const filterPrefix = `F${Date.now().toString().slice(-6)}`
  const matchingNickname = `${filterPrefix}A`
  await Promise.all([
    sql(
      (db) => db`
      update app.profiles set class_id = ${classIds.mage}, game_nickname = ${matchingNickname}
      where id = ${member.id}
    `,
    ),
    sql(
      (db) => db`
      update app.profiles set class_id = ${classIds.warrior}, game_nickname = ${`${filterPrefix}B`}
      where id = ${otherMember.id}
    `,
    ),
    sql(
      (db) => db`
      update app.profiles set class_id = ${classIds.mage}, game_nickname = ${`${filterPrefix}C`}
      where id = ${officer.id}
    `,
    ),
  ])

  await signInUi(page, admin.email)
  await expectSignedIn(page)
  await page.goto('./#/admin')
  await page.getByRole('table').waitFor()
  await openFiltersWhenNarrow(page)

  await page.getByRole('combobox', { name: 'Фильтр по классу' }).click()
  await page.getByRole('option', { name: 'Маг' }).click()
  await page.getByRole('combobox', { name: 'Фильтр по роли' }).click()
  await page.getByRole('option', { name: 'Член клана' }).click()
  await page
    .getByLabel('Поиск по нику, имени, email и классу')
    .fill(filterPrefix)

  await expect(page.getByText('Аккаунтов: 1', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('row', { name: new RegExp(matchingNickname) }),
  ).toBeVisible()
  await expect(
    page.getByRole('row', { name: new RegExp(officer.nickname) }),
  ).toHaveCount(0)
  await page.getByRole('combobox', { name: 'Сортировка' }).click()
  await page.getByRole('option', { name: 'Дата регистрации' }).click()
  await expect(page).toHaveURL(new RegExp(`classId=${classIds.mage}`))
  await expect(page).toHaveURL(/role=member/)
  await expect(page).toHaveURL(/sort=registered/)

  const filtersButton = page.getByRole('button', { name: 'Фильтры' })
  if (await filtersButton.isVisible()) {
    await filtersButton.click()
  }
  await page.setViewportSize({ width: 375, height: 812 })
  await expect(filtersButton).toHaveAttribute('aria-expanded', 'false')
  await filtersButton.click()
  await expect(filtersButton).toHaveAttribute('aria-expanded', 'true')
  await expect(
    page.getByRole('combobox', { name: 'Фильтр по классу' }),
  ).toBeVisible()
  expect(await hasHorizontalScroll(page)).toBe(false)
})

test('ADM: поиск, карточка, журнал и безвозвратное удаление', async ({
  page,
}) => {
  const [admin, officer, target] = await Promise.all([
    createMember('admin'),
    createMember('officer'),
    createMember('officer'),
  ])
  const changedNickname = `M${Date.now().toString().slice(-8)}`
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
  await openFiltersWhenNarrow(page)

  // Поиск и карточка (ADM-02, ADM-03).
  await page
    .getByLabel('Поиск по нику, имени, email и классу')
    .fill(target.nickname)
  await expect(page.getByText('Аккаунтов: 1', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Карточка' }).click()
  const card = page.getByRole('dialog', { name: 'Карточка аккаунта' })
  await expect(card.getByText(target.email)).toBeVisible()
  await expect(card.getByText('Москва')).toBeVisible()
  await card.getByRole('button', { name: 'Изменить профиль' }).click()
  const profile = card.getByRole('region', {
    name: 'Изменение ника и класса',
  })
  await profile.getByLabel('Игровой ник').fill(changedNickname)
  await profile.getByRole('combobox', { name: 'Класс' }).click()
  await page.getByRole('option', { name: 'Маг' }).click()
  await profile.getByRole('button', { name: 'Сохранить' }).click()
  await expect(card.locator('strong')).toHaveText(changedNickname)
  await expect(card.getByText('Маг', { exact: true })).toBeVisible()

  const profileAudit = await sql(
    (db) => db<{ details: { changed_fields: string[] } }[]>`
      select details from app.audit_log
      where target_user_id = ${target.id} and action = 'profile_updated'
      order by created_at desc, id desc limit 1`,
  )
  expect(profileAudit[0]?.details.changed_fields).toEqual([
    'game_nickname',
    'class_id',
  ])

  await page.keyboard.press('Escape')
  await page
    .getByLabel('Поиск по нику, имени, email и классу')
    .fill(changedNickname)
  await expect(
    page.getByRole('row', { name: new RegExp(changedNickname) }),
  ).toBeVisible()

  await page.setViewportSize({ width: 375, height: 812 })
  await page.getByRole('button', { name: 'Карточка' }).click()
  const narrowCard = page.getByRole('dialog', { name: 'Карточка аккаунта' })
  await narrowCard.getByRole('button', { name: 'Изменить профиль' }).click()
  expect(await hasHorizontalScroll(page)).toBe(false)
  await narrowCard.getByRole('button', { name: 'Отмена' }).click()
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 1280, height: 800 })
  expect(await hasHorizontalScroll(page)).toBe(false)

  // Удаление с подтверждением ником (Q-73).
  await page
    .getByRole('button', { name: `Действия с ${changedNickname}` })
    .click()
  await page.getByRole('menuitem', { name: 'Удалить навсегда' }).click()
  const dialog = page.getByRole('dialog')
  await dialog
    .getByLabel(`Введите ник «${changedNickname}» для подтверждения`)
    .fill(changedNickname)
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
  await page.getByLabel('Поиск по исполнителю и событию').fill(changedNickname)
  const entry = page
    .getByRole('article')
    .filter({ hasText: 'Безвозвратное удаление пользователя' })
    .filter({ hasText: target.email })
  await expect(entry).toHaveCount(1)
  await expect(entry.getByText(new RegExp(changedNickname))).toBeVisible()
  expect(await hasHorizontalScroll(page)).toBe(false)
})
