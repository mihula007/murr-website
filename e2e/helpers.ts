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
  const location = new URL(page.url())
  const [routePath, routeQuery = ''] = location.hash.slice(1).split('?')
  const isMemberRoster =
    routePath === '/roster' &&
    new URLSearchParams(routeQuery).get('view') !== 'readers'
  const isDesktop = (page.viewportSize()?.width ?? 1280) >= 1024
  const rosterScroller = page.getByRole('region', {
    name: 'Прокручиваемый список: Участники',
  })
  if (isMemberRoster && isDesktop && (await target.count()) === 0) {
    await rosterScroller
      .waitFor({ state: 'visible', timeout: 15_000 })
      .catch(() => undefined)
  }
  if (isMemberRoster && (await target.count()) === 0) {
    if ((await rosterScroller.count()) > 0) {
      await rosterScroller.evaluate((element) => {
        element.scrollTop = 0
      })
    } else {
      await page.evaluate(() => window.scrollTo(0, 0))
    }
  }
  if ((await rosterScroller.count()) > 0) {
    let stalled = 0
    for (let step = 0; step < 1000 && stalled < 20; step += 1) {
      if ((await target.count()) > 0) {
        await target.first().scrollIntoViewIfNeeded()
        await expect(target.first()).toBeVisible()
        return
      }
      const moved = await rosterScroller.evaluate((element) => {
        const before = element.scrollTop
        element.scrollBy(0, element.clientHeight * 0.75)
        return element.scrollTop !== before
      })
      const loading = await page
        .getByText('Загружаем ещё…', { exact: true })
        .isVisible()
        .catch(() => false)
      stalled = moved || loading ? 0 : stalled + 1
      await page.waitForTimeout(150)
    }
    throw new Error('Элемент не найден в прокручиваемом списке состава')
  }

  let stalled = 0
  for (let step = 0; step < 1000 && stalled < 20; step += 1) {
    if ((await target.count()) > 0) {
      await target.first().scrollIntoViewIfNeeded()
      await expect(target.first()).toBeVisible()
      return
    }
    const moved = await page.evaluate(() => {
      const before = window.scrollY
      window.scrollBy(0, window.innerHeight * 0.75)
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

/**
 * Адрес, который кнопка мессенджера в кабинете открывает в новой вкладке
 * (Q-105). Внешний сайт мессенджера не загружается: запрос перехватывается,
 * вкладка закрывается.
 */
export async function openedMessengerUrl(
  page: Page,
  name: RegExp,
  pattern: RegExp,
) {
  const context = page.context()
  let resolve!: (url: string) => void
  const opened = new Promise<string>((done) => {
    resolve = done
  })
  await context.route(pattern, (route) => {
    resolve(route.request().url())
    return route.fulfill({ status: 200, body: '' })
  })
  await page
    .getByRole('region', { name: 'Мессенджеры' })
    .getByRole('button', { name })
    .click()
  const url = await opened
  await context.unroute(pattern)
  for (const other of context.pages()) {
    if (other !== page) {
      await other.close()
    }
  }
  return url
}
