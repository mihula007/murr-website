import { expect, test, type Browser, type Page } from '@playwright/test'
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
  'Сценарии рынка проверяются на корневом пути',
)

test.beforeEach(async ({ page }) => {
  test.setTimeout(180_000)
  await skipSplash(page)
})

async function signedInPage(browser: Browser, email: string) {
  const context = await browser.newContext({ ...test.info().project.use })
  const page = await context.newPage()
  await skipSplash(page)
  await signInUi(page, email)
  await expectSignedIn(page)
  return page
}

/** Повторный визит другого пользователя: полная загрузка, без кеша SPA. */
async function revisit(page: Page, path: string) {
  await page.goto(path)
  await page.reload()
}

const unique = (prefix: string) =>
  `${prefix} ${Math.random().toString(36).slice(2, 8)}`

test('E2E-05: собственное объявление, чужое без управления, администратор правит любое', async ({
  page,
  browser,
}) => {
  const [author, other, admin] = await Promise.all([
    createMember('member'),
    createMember('officer'),
    createMember('admin'),
  ])
  const title = unique('Продам меч')

  // Член создаёт черновик, правит и публикует своё объявление.
  await signInUi(page, author.email)
  await expectSignedIn(page)
  await page.goto('./#/market/new')
  await expect(page.getByText('Вложения')).toHaveCount(0)
  await page.getByLabel('Заголовок').fill(title)
  const editor = page.getByRole('textbox', { name: 'Содержимое' })
  await editor.click()
  await editor.pressSequentially('Цена договорная')
  await page.getByRole('button', { name: 'Сохранить черновик' }).click()
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  const draftUrl = page.url().replace(/^.*#/, './#')

  // Офицер чужого черновика не видит (MKT-05, MKT-06).
  const otherPage = await signedInPage(browser, other.email)
  await revisit(otherPage, draftUrl)
  await expect(otherPage.getByText('Материал не найден')).toBeVisible()

  await page.getByRole('link', { name: 'Редактировать' }).click()
  await page.getByLabel('Заголовок').fill(`${title} (правка)`)
  await page.getByRole('button', { name: 'Опубликовать' }).click()
  await expect(
    page.getByRole('heading', { name: `${title} (правка)` }),
  ).toBeVisible()

  // Другой участник читает, но не управляет; прямой вызов тоже отклонён.
  await revisit(otherPage, draftUrl)
  await expect(
    otherPage.getByRole('heading', { name: `${title} (правка)` }),
  ).toBeVisible()
  await expect(
    otherPage.getByRole('link', { name: 'Редактировать' }),
  ).toHaveCount(0)
  await expect(otherPage.getByText(`Автор: ${author.nickname}`)).toBeVisible()
  const id = draftUrl.split('/').pop() as string
  const denied = await callApi(
    'market/delete',
    await accessToken(other.email),
    {
      id,
    },
  )
  expect(denied.status).toBe(403)

  // Администратор правит чужое объявление и видит черновики всех.
  const adminPage = await signedInPage(browser, admin.email)
  await revisit(adminPage, `${draftUrl}/edit`)
  await adminPage.getByLabel('Заголовок').fill(`${title} (админ)`)
  await adminPage
    .getByRole('button', { name: 'Сохранить как черновик' })
    .click()
  await expect(
    adminPage.getByRole('heading', { name: `${title} (админ)` }),
  ).toBeVisible()
  await revisit(adminPage, './#/market?tab=drafts')
  await expect(
    adminPage.getByRole('link', { name: `${title} (админ)` }),
  ).toBeVisible()
  expect(await hasHorizontalScroll(adminPage)).toBe(false)

  // Снятое с публикации объявление исчезает из чужой ленты (MKT 4).
  await revisit(otherPage, './#/market')
  await expect(
    otherPage.getByRole('link', { name: new RegExp(title) }),
  ).toHaveCount(0)
})

test('лента рынка: больше 50 объявлений — нумерованные страницы (Q-55)', async ({
  page,
}) => {
  const member = await createMember('member')
  const prefix = unique('Лот')
  await sql(
    (db) => db`
      insert into app.market_listings
        (category, title, content, search_text, excerpt, status, author_id,
         published_at, updated_at)
      select 'sale', ${prefix} || ' №' || n,
        '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"т"}]}]}'::jsonb,
        lower(${prefix} || ' №' || n), 'т', 'published', ${member.id},
        now(), now() - (n || ' seconds')::interval
      from generate_series(1, 55) as n`,
  )
  await signInUi(page, member.email)
  await expectSignedIn(page)
  await page.goto(`./#/market?q=${encodeURIComponent(prefix)}`)
  await expect(
    page.getByRole('link', { name: `${prefix} №1`, exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('list', { name: 'Внутри клана' }).getByRole('listitem'),
  ).toHaveCount(50)
  await page.getByRole('button', { name: 'Следующая страница' }).click()
  await expect(
    page.getByRole('list', { name: 'Внутри клана' }).getByRole('listitem'),
  ).toHaveCount(5)
  await expect(page).toHaveURL(/page=2/)
  expect(await hasHorizontalScroll(page)).toBe(false)
})
