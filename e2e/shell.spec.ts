import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { hasHorizontalScroll, skipSplash } from './helpers'

test.beforeEach(async ({ page }) => {
  await skipSplash(page)
})

test('гость видит «Вход» и пустое меню', async ({ page }) => {
  await page.goto('./#/')
  const header = page.getByRole('banner')
  await expect(header.getByRole('link', { name: 'Вход' })).toBeVisible()
  await expect(
    header.getByRole('button', { name: 'Открыть меню' }),
  ).toHaveCount(0)
  for (const category of ['Клан', 'Сообщество', 'Управление']) {
    await expect(
      header.getByRole('button', { name: category, exact: true }),
    ).toHaveCount(0)
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
  await expect(page).toHaveURL(/#\/account$/)
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible()
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
  for (const path of ['./#/', './#/votes', './#/unknown', './#/account']) {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
    expect(await hasHorizontalScroll(page), path).toBe(false)
  }
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
