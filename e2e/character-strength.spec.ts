import { expect, test } from '@playwright/test'
import { hasHorizontalScroll, skipSplash } from './helpers'
import {
  accessToken,
  auditActions,
  callApi,
  createMember,
  expectSignedIn,
  localStack,
  signInUi,
  sql,
} from './supabase'

test.skip(
  ({ baseURL }) => Boolean(baseURL?.includes('/repository/')),
  'Сценарии состава проверяются на корневом пути',
)

test.beforeEach(async ({ page }) => {
  test.setTimeout(180_000)
  await skipSplash(page)
})

test('характеристики доступны админу и внутренним ролям, рейтинг сортируется', async ({
  page,
}) => {
  const [admin, first, second, applicant, reader] = await Promise.all([
    createMember('admin'),
    createMember('member'),
    createMember('member'),
    createMember('applicant'),
    createMember('reader'),
  ])
  await Promise.all(Array.from({ length: 15 }, () => createMember('member')))
  await sql(
    (db) => db`
    update app.profiles set class_id = 1 where id = ${first.id}
  `,
  )
  await sql(
    (db) => db`
    update app.profiles set class_id = 7 where id = ${second.id}
  `,
  )

  const notificationsBefore = await sql(
    (db) => db<{ count: number }[]>`
      select count(*)::integer as count from app.user_notifications
      where recipient_id = ${first.id}`,
  )

  await signInUi(page, admin.email)
  await expectSignedIn(page)
  await page.goto('./#/admin')
  const filtersButton = page.getByRole('button', { name: 'Фильтры' })
  if (await filtersButton.isVisible()) {
    await filtersButton.click()
  }

  for (const [member, value, saved] of [
    [first, '125,5к', '125500'],
    [second, '80к', '80000'],
  ] as const) {
    await page
      .getByLabel('Поиск по нику, имени, email и классу')
      .fill(member.nickname)
    await expect(page.getByText('Аккаунтов: 1', { exact: true })).toBeVisible()
    await expect(page.getByText(member.nickname, { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Карточка' }).click()
    const accountCard = page.getByRole('dialog', { name: 'Карточка аккаунта' })
    await expect(accountCard.getByText(member.email)).toBeVisible()
    const statsPanel = accountCard.getByRole('region', {
      name: 'Характеристика персонажа',
    })
    await expect(statsPanel).toBeVisible()
    const profileBounds = await accountCard
      .getByText(member.email)
      .boundingBox()
    const statsBounds = await statsPanel.boundingBox()
    expect(profileBounds).not.toBeNull()
    expect(statsBounds).not.toBeNull()
    if ((page.viewportSize()?.width ?? 1280) >= 768) {
      expect(statsBounds!.x).toBeGreaterThan(profileBounds!.x)
    } else {
      expect(statsBounds!.y).toBeGreaterThan(profileBounds!.y)
      expect(await hasHorizontalScroll(page)).toBe(false)
    }
    await accountCard.getByLabel('ПА').fill(value)
    if (member.id === first.id) {
      await accountCard.getByLabel('Источник').fill('Прототип HTML')
    }
    await accountCard.getByRole('button', { name: 'Сохранить' }).click()
    await expect(page.getByText('Характеристика сохранена')).toBeVisible()
    await expect(
      accountCard.getByRole('button', { name: 'Сохранить' }),
    ).toBeDisabled()
    await expect(accountCard.getByLabel('ПА')).toHaveValue(saved)
    await page.keyboard.press('Escape')
  }

  const actions = await auditActions(first.id)
  // Одно сохранение двух полей — одна запись журнала.
  expect(actions).toHaveLength(1)
  const notificationsAfter = await sql(
    (db) => db<{ count: number }[]>`
      select count(*)::integer as count from app.user_notifications
      where recipient_id = ${first.id}`,
  )
  expect(notificationsAfter[0]!.count).toBe(notificationsBefore[0]!.count)

  const memberToken = await accessToken(first.email)
  const rosterResponse = await callApi('roster/list', memberToken)
  expect(rosterResponse.status).toBe(200)
  const listedMember = (
    rosterResponse.body.items as Record<string, unknown>[]
  ).find((item) => item.gameNickname === first.nickname)
  expect(listedMember).toMatchObject({ pa: 125500 })
  expect(listedMember).not.toHaveProperty('characterStatsSource')

  for (const email of [applicant.email, reader.email]) {
    const response = await callApi('roster/list', await accessToken(email))
    expect(response.status).not.toBe(200)
  }
  const guestResponse = await callApi('roster/list', localStack().ANON_KEY)
  expect(guestResponse.status).not.toBe(200)

  await signInUi(page, first.email)
  await expectSignedIn(page)
  await page.goto('./#/roster')
  const firstCard = page
    .getByRole('list', { name: 'Участники' })
    .getByRole('listitem')
    .filter({ hasText: first.nickname })
  const identity = firstCard
    .getByRole('heading', { name: first.nickname })
    .locator('..')
  await expect(identity).toContainText(String(listedMember?.className))
  await expect(firstCard.getByText('ПА')).toBeVisible()
  await expect(firstCard.getByText('125 500')).toBeVisible()
  await expect(
    firstCard.locator('dl[aria-label^="Характеристика"] > div'),
  ).toHaveCount(5)
  await expect(firstCard.getByText('Прототип HTML')).toHaveCount(0)
  if ((page.viewportSize()?.width ?? 1280) < 900) {
    expect(await hasHorizontalScroll(page)).toBe(false)
  }

  await page.goto('./#/')
  const rating = page.getByRole('region', { name: 'Рейтинг силы' })
  const mobile = (page.viewportSize()?.width ?? 1280) < 900
  await expect(rating).toBeVisible()
  await expect(rating.getByText(first.nickname)).toBeVisible()
  await expect(rating.getByText(second.nickname)).toBeVisible()
  const scrollArea = rating.getByRole('region', {
    name: 'Прокручиваемый список рейтинга силы',
  })
  const ratingRows = rating.locator('tbody tr')
  if (mobile) {
    // HOM-17: на телефоне своей прокрутки у рейтинга нет — жест над
    // карточками прокручивает страницу; остальные — по «Показать всех».
    await expect(ratingRows).toHaveCount(15)
    expect(
      await scrollArea.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
    ).toBe(false)
    await ratingRows.nth(3).scrollIntoViewIfNeeded()
    const box = await ratingRows.nth(3).boundingBox()
    const before = await page.evaluate(() => window.scrollY)
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await page.mouse.wheel(0, 600)
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(before)
    await rating.getByRole('button', { name: /Показать всех/ }).click()
  }
  expect(await ratingRows.count()).toBeGreaterThanOrEqual(16)
  await expect(
    ratingRows.nth(0).getByRole('cell', { name: 'Место 01' }),
  ).toBeVisible()
  await expect(
    ratingRows.nth(1).getByRole('cell', { name: 'Место 02' }),
  ).toBeVisible()
  await expect(ratingRows.nth(0)).toHaveClass(/bg-surface-inset/)
  await expect(ratingRows.nth(1)).toHaveClass(/bg-surface-from/)
  const firstStrengthRow = ratingRows.filter({ hasText: first.nickname })
  const secondStrengthRow = ratingRows.filter({ hasText: second.nickname })
  await expect(firstStrengthRow).toHaveClass(/bg-item-highlight!?/)
  await expect(secondStrengthRow).not.toHaveClass(/bg-item-highlight!?/)
  if (!mobile) {
    expect(
      await scrollArea.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
    ).toBe(true)
    expect(
      await scrollArea.evaluate((element) => {
        const bounds = element.getBoundingClientRect()
        return Array.from(element.querySelectorAll('tbody tr')).filter(
          (row) => {
            const rowBounds = row.getBoundingClientRect()
            return (
              rowBounds.top >= bounds.top && rowBounds.bottom <= bounds.bottom
            )
          },
        ).length
      }),
      // До 15 строк, но область не выше окна (HOM-17).
    ).toBeGreaterThanOrEqual(5)
  }
  if (mobile) {
    expect(await hasHorizontalScroll(page)).toBe(false)
  }
  await expect(
    rating
      .locator('tbody tr')
      .filter({ hasText: first.nickname })
      .getByText('125 500'),
  ).toBeVisible()
  const paHeader = rating.getByRole('columnheader', { name: 'ПА' })
  if (!mobile) {
    await expect(paHeader).toHaveAttribute('aria-sort', 'descending')
  }
  let names = await rating.locator('tbody tr').allTextContents()
  expect(names.findIndex((name) => name.includes(first.nickname))).toBeLessThan(
    names.findIndex((name) => name.includes(second.nickname)),
  )
  if (mobile) {
    await rating.getByRole('button', { name: /По убыванию/ }).click()
    await expect(
      rating.getByRole('button', { name: /По возрастанию/ }),
    ).toBeVisible()
  } else {
    await rating.getByRole('button', { name: /ПА/ }).click()
    await expect(paHeader).toHaveAttribute('aria-sort', 'ascending')
  }
  names = await rating.locator('tbody tr').allTextContents()
  expect(
    names.findIndex((name) => name.includes(second.nickname)),
  ).toBeLessThan(names.findIndex((name) => name.includes(first.nickname)))
  if (mobile) {
    await rating.getByRole('button', { name: /По возрастанию/ }).click()
  } else {
    await rating.getByRole('button', { name: /ПА/ }).click()
    await expect(paHeader).toHaveAttribute('aria-sort', 'descending')
  }
  names = await rating.locator('tbody tr').allTextContents()
  expect(names.findIndex((name) => name.includes(first.nickname))).toBeLessThan(
    names.findIndex((name) => name.includes(second.nickname)),
  )
  const shell = page.locator('#main-content').locator('xpath=..')
  const layoutBeforeFilter = await shell.evaluate((element) => {
    const background = element.parentElement?.querySelector(
      ':scope > [aria-hidden="true"]',
    )
    const { left, width } = element.getBoundingClientRect()
    const backgroundBounds = background?.getBoundingClientRect()
    return {
      left,
      width,
      backgroundLeft: backgroundBounds?.left,
      backgroundWidth: backgroundBounds?.width,
      bodyMarginRight: getComputedStyle(document.body).marginRight,
    }
  })
  await rating.getByRole('combobox', { name: 'Класс' }).click()
  expect(
    await shell.evaluate((element) => {
      const background = element.parentElement?.querySelector(
        ':scope > [aria-hidden="true"]',
      )
      const { left, width } = element.getBoundingClientRect()
      const backgroundBounds = background?.getBoundingClientRect()
      return {
        left,
        width,
        backgroundLeft: backgroundBounds?.left,
        backgroundWidth: backgroundBounds?.width,
        bodyMarginRight: getComputedStyle(document.body).marginRight,
      }
    }),
  ).toEqual(layoutBeforeFilter)
  await page.getByRole('option', { name: 'Маг', exact: true }).click()
  expect(
    await shell.evaluate((element) => {
      const background = element.parentElement?.querySelector(
        ':scope > [aria-hidden="true"]',
      )
      const { left, width } = element.getBoundingClientRect()
      const backgroundBounds = background?.getBoundingClientRect()
      return {
        left,
        width,
        backgroundLeft: backgroundBounds?.left,
        backgroundWidth: backgroundBounds?.width,
        bodyMarginRight: getComputedStyle(document.body).marginRight,
      }
    }),
  ).toEqual(layoutBeforeFilter)
  await expect(rating.getByText(second.nickname)).toBeVisible()
  await expect(rating.getByText(first.nickname)).toHaveCount(0)
  await expect(
    rating.locator('tbody tr').nth(0).getByRole('cell', { name: 'Место 01' }),
  ).toBeVisible()
})
