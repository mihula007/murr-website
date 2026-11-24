import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { hasHorizontalScroll, skipSplash } from './helpers'

test.beforeEach(async ({ page }) => {
  await skipSplash(page)
})

test('гость видит «Вход» и разделы Кузни', async ({ page, isMobile }) => {
  await page.goto('./#/')
  const header = page.getByRole('banner')
  await expect(header.getByRole('link', { name: 'Вход' })).toBeVisible()
  if (isMobile) {
    await header.getByRole('button', { name: 'Открыть меню' }).click()
    const nav = page.getByRole('navigation', { name: 'Мобильная навигация' })
    await expect(nav.getByRole('heading', { name: 'Кузня' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Боги' })).toBeVisible()
    await expect(nav.getByRole('heading', { name: 'Клан' })).toHaveCount(0)
  } else {
    await header.getByRole('button', { name: 'Кузня', exact: true }).click()
    await expect(page.getByRole('link', { name: 'Боги' })).toBeVisible()
  }
})

test('прямая ссылка на закрытый раздел показывает «Нет доступа» и после перезагрузки', async ({
  page,
}) => {
  await page.goto('./#/votes')
  await expect(page.getByRole('heading', { name: 'Нет доступа' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Голосование' })).toHaveCount(
    0,
  )
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Нет доступа' })).toBeVisible()
  await page.getByRole('link', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/#\/login$/)
  await expect(
    page.getByRole('heading', { name: 'Вход в Murr клан' }),
  ).toBeVisible()
})

test('неизвестный адрес показывает 404', async ({ page }) => {
  await page.goto('./#/unknown')
  await expect(
    page.getByRole('heading', { name: 'Страница не найдена' }),
  ).toBeVisible()
})

test('нет горизонтальной прокрутки на главной, закрытом разделе и 404', async ({
  page,
}) => {
  for (const path of [
    './#/',
    './#/votes',
    './#/unknown',
    './#/login',
    './#/register',
    './#/reset-password',
  ]) {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
    expect(await hasHorizontalScroll(page), path).toBe(false)
  }
})

test('фон выше короткой страницы обрезается и не добавляет прокрутку', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Проверка широкого экрана')
  // На широком экране картинка (95px + 55vw) выше окна; главная гостя — нет.
  await page.setViewportSize({ width: 1920, height: 900 })
  await page.goto('./#/')
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight <= window.innerHeight,
    ),
  ).toBe(true)
})

test('dev-переключатель ролей отсутствует в production', async ({ page }) => {
  await page.goto('./#/')
  await expect(page.getByRole('banner')).toBeVisible()
  await expect(page.getByLabel('Смотреть как…')).toHaveCount(0)
  await expect(page.locator('.dev-role-switcher')).toHaveCount(0)
  await page.goto('./#/dev/unsaved-demo')
  await expect(
    page.getByRole('heading', { name: 'Страница не найдена' }),
  ).toBeVisible()
})

test('сборка dist не содержит dev-инструментов', () => {
  const assets = join(process.cwd(), 'dist', 'assets')
  const scripts = readdirSync(assets).filter((file) => file.endsWith('.js'))
  expect(scripts.length).toBeGreaterThan(0)
  for (const file of scripts) {
    const source = readFileSync(join(assets, file), 'utf8')
    for (const marker of [
      'DevRoleSwitcher',
      'murr-dev-role',
      'Смотреть как',
      'unsaved-demo',
    ]) {
      expect(source.includes(marker), `${marker} в ${file}`).toBe(false)
    }
  }
})
