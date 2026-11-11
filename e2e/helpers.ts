import { expect, type Page } from '@playwright/test'

/** Совпадает с `ACTIVITY_KEY` в `src/app/splash/splash-timing.ts`. */
export const ACTIVITY_KEY = 'murr-last-activity'

/** Ставит свежую метку активности, чтобы заставка не перекрывала сценарий. */
export async function skipSplash(page: Page) {
  await page.addInitScript((key) => {
    localStorage.setItem(key, String(Date.now()))
  }, ACTIVITY_KEY)
}

export async function hasHorizontalScroll(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  )
}

/**
 * Внутреннее меню: на десктопе — категория «Клан», на мобильном — кнопка
 * открытия меню. Гость, кандидат и чтец меню разделов не видят.
 */
export async function expectInternalMenu(page: Page, visible: boolean) {
  const trigger = page
    .getByRole('banner')
    .getByRole('button', { name: /^(Клан|Открыть меню)$/ })
    .filter({ visible: true })
  if (visible) await expect(trigger.first()).toBeVisible({ timeout: 15_000 })
  else await expect(trigger).toHaveCount(0)
}
