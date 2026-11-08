import type { Page } from '@playwright/test'

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
