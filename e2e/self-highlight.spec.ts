import { expect, test } from '@playwright/test'
import { hasHorizontalScroll, scrollUntilVisible, skipSplash } from './helpers'
import {
  accessToken,
  callApi,
  createMember,
  expectSignedIn,
  signInUi,
} from './supabase'

test.skip(
  ({ baseURL }) => Boolean(baseURL?.includes('/repository/')),
  'Сценарии клана проверяются на корневом пути',
)

test.beforeEach(async ({ page }) => {
  test.setTimeout(180_000)
  await skipSplash(page)
})

function moscowDate(days = 3) {
  return new Date(Date.now() + (3 + 24 * days) * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
}

test('E2E-12: участник находит себя в основных списках', async ({ page }) => {
  const [current, other] = await Promise.all([
    createMember('officer'),
    createMember('member'),
  ])
  const title = `E2E подсветка ${Date.now()}`
  const created = await callApi(
    'events/create',
    await accessToken(current.email),
    {
      title,
      type: 'pve',
      date: moscowDate(),
      time: '20:00',
      description: 'Проверка подсветки участника',
    },
  )
  expect(created.status).toBe(200)
  const eventId = created.body.id as string
  for (const person of [current, other]) {
    const response = await callApi(
      'events/respond',
      await accessToken(person.email),
      { eventId, answer: 'yes' },
    )
    expect(response.status).toBe(200)
  }

  await signInUi(page, current.email)
  await expectSignedIn(page)

  for (const width of [1240, 375]) {
    await page.setViewportSize({ width, height: 900 })

    await page.goto('./#/roster')
    const roster = page.getByRole('list', { name: 'Участники' })
    const currentCard = roster.getByRole('listitem').filter({
      hasText: current.nickname,
    })
    await scrollUntilVisible(page, currentCard)
    const otherCard = roster.getByRole('listitem').filter({
      hasText: other.nickname,
    })
    await expect(currentCard.locator(':scope > div')).toHaveClass(
      /bg-item-highlight/,
    )
    await scrollUntilVisible(page, otherCard)
    await expect(otherCard.locator(':scope > div')).not.toHaveClass(
      /bg-item-highlight/,
    )

    await page.goto(`./#/events/${eventId}`)
    if (width === 1240) {
      const pool = page.getByRole('list', { name: 'Придут' })
      const currentPoolRow = pool
        .getByRole('listitem')
        .filter({
          hasText: current.nickname,
        })
        .locator(':scope > div')
      const otherPoolRow = pool
        .getByRole('listitem')
        .filter({
          hasText: other.nickname,
        })
        .locator(':scope > div')
      await expect(currentPoolRow).toHaveClass(/bg-item-highlight/)
      await expect(otherPoolRow).not.toHaveClass(/bg-item-highlight/)

      await page.getByRole('button', { name: 'Создать группу' }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByLabel('Название группы').fill('Пати подсветки')
      await dialog.getByRole('button', { name: 'Создать' }).click()
      await expect(dialog).toBeHidden()
      await page
        .getByRole('button', { name: `Действия: ${current.nickname}` })
        .click()
      await page.getByRole('menuitem', { name: 'Пати подсветки' }).click()
      const group = page.getByRole('list', {
        name: 'Состав «Пати подсветки»',
      })
      await expect(
        group.getByRole('listitem').filter({ hasText: current.nickname }),
      ).toHaveClass(/bg-item-highlight/)
      await expect(
        pool.getByRole('listitem').filter({ hasText: other.nickname }),
      ).not.toHaveClass(/bg-item-highlight/)

      await page.getByRole('button', { name: 'Завершить событие' }).click()
      await page
        .getByRole('alertdialog')
        .getByRole('button', { name: 'Завершить' })
        .click()
      await expect(page.getByRole('list', { name: 'Посетили' })).toContainText(
        current.nickname,
      )
    } else {
      const group = page.getByRole('list', {
        name: 'Состав «Пати подсветки»',
      })
      await expect(
        group.getByRole('listitem').filter({ hasText: current.nickname }),
      ).toHaveClass(/bg-item-highlight/)
      await page.getByRole('tab', { name: /Не посетили/ }).click()
      const missed = page.getByRole('list', { name: 'Не посетили' })
      await expect(
        missed.getByRole('listitem').filter({ hasText: other.nickname }),
      ).not.toHaveClass(/bg-item-highlight/)
    }

    await page.goto('./#/rating')
    const rating = page.getByRole('table', { name: 'Рейтинг посещения' })
    await expect(rating).toBeVisible()
    await expect(
      rating.getByRole('row').filter({ hasText: current.nickname }),
    ).toHaveClass(/bg-item-highlight/)
    await expect(
      rating.getByRole('row').filter({ hasText: other.nickname }),
    ).not.toHaveClass(/bg-item-highlight/)
    expect(await hasHorizontalScroll(page)).toBe(false)
  }
})
