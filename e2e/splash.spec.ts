import { expect, test, type Page } from '@playwright/test'
import { ACTIVITY_KEY } from './helpers'

async function isScrollLocked(page: Page) {
  return page.evaluate(() => {
    const html = getComputedStyle(document.documentElement).overflow
    const body = getComputedStyle(document.body).overflow
    return html === 'hidden' || body === 'hidden'
  })
}

async function canScroll(page: Page) {
  return page.evaluate(async () => {
    const filler = document.createElement('div')
    filler.style.height = '3000px'
    document.body.append(filler)
    window.scrollTo(0, 500)
    await new Promise((resolve) => requestAnimationFrame(resolve))
    const scrolled = window.scrollY > 0
    window.scrollTo(0, 0)
    filler.remove()
    return scrolled
  })
}

test('заставка показывается при первом открытии и снимает блокировку после пропуска', async ({
  page,
}) => {
  await page.goto('./#/')
  const splash = page.getByRole('dialog', { name: 'MurrClan' })
  await expect(splash).toBeVisible()
  const skip = page.getByRole('button', { name: 'Пропустить анимацию' })
  await expect(skip).toBeFocused()
  expect(await isScrollLocked(page)).toBe(true)

  await skip.click()
  await expect(splash).toHaveCount(0)
  expect(await isScrollLocked(page)).toBe(false)
  expect(await canScroll(page)).toBe(true)
  await expect(
    page.getByRole('heading', { name: 'Легенда продолжается Вместе с Murr' }),
  ).toBeVisible()
  expect(
    await page.evaluate((key) => localStorage.getItem(key), ACTIVITY_KEY),
  ).not.toBeNull()
})

test('заставка закрывается по Escape', async ({ page }) => {
  await page.goto('./#/')
  await expect(page.getByRole('dialog', { name: 'MurrClan' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'MurrClan' })).toHaveCount(0)
  expect(await isScrollLocked(page)).toBe(false)
})

test('повторный визит в течение 10 минут проходит без заставки', async ({
  page,
}) => {
  await page.goto('./#/')
  await page.getByRole('button', { name: 'Пропустить анимацию' }).click()
  await expect(page.getByRole('dialog', { name: 'MurrClan' })).toHaveCount(0)
  await page.reload()
  await expect(
    page.getByRole('heading', { name: 'Легенда продолжается Вместе с Murr' }),
  ).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'MurrClan' })).toHaveCount(0)
  expect(await isScrollLocked(page)).toBe(false)
})

test('с reduced motion заставка исчезает сразу', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('./#/')
  await page.getByRole('button', { name: 'Пропустить анимацию' }).click()
  await expect(page.getByRole('dialog', { name: 'MurrClan' })).toHaveCount(0, {
    timeout: 300,
  })
  expect(await canScroll(page)).toBe(true)
})
