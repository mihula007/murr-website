import { expect, type Locator, type Page } from '@playwright/test'

/** Совпадает с `ACTIVITY_KEY` в `src/app/splash/splash-timing.ts`. */
export const ACTIVITY_KEY = 'murr-last-activity'

/** Ставит свежую метку активности, чтобы заставка не перекрывала сценарий. */
export async function skipSplash(page: Page) {
  await page.addInitScript((key) => {
    localStorage.setItem(key, String(Date.now()))
  }, ACTIVITY_KEY)
}

/**
 * Большие списки догружаются при прокрутке и рисуют только видимые строки:
 * прокручивает окно, пока элемент не появится, как это сделал бы человек.
 */
export async function scrollUntilVisible(page: Page, target: Locator) {
  // Прокрутка до цели или до конца страницы: локальная БД копит записи
  // от прогона к прогону, фиксированного числа экранов не хватает.
  let stalled = 0
  for (let step = 0; step < 1000 && stalled < 20; step += 1) {
    if ((await target.count()) > 0) {
      await target.first().scrollIntoViewIfNeeded()
      await expect(target.first()).toBeVisible()
      return
    }
    const moved = await page.evaluate(() => {
      const before = window.scrollY
      window.scrollBy(0, window.innerHeight)
      return window.scrollY !== before
    })
    // В конце страницы ждём догрузку следующей страницы списка.
    stalled = moved ? 0 : stalled + 1
    await page.waitForTimeout(150)
  }
  throw new Error('Элемент не найден в списке после прокрутки')
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
  if (visible) {
    await expect(trigger.first()).toBeVisible({ timeout: 15_000 })
  } else {
    await expect(trigger).toHaveCount(0)
  }
}
