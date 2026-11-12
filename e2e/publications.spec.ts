import { expect, test, type Browser, type Page } from '@playwright/test'
import { hasHorizontalScroll, skipSplash } from './helpers'
import {
  accessToken,
  callApi,
  createMember,
  expectSignedIn,
  signInUi,
} from './supabase'

test.skip(
  ({ baseURL }) => Boolean(baseURL?.includes('/repository/')),
  'Сценарии публикаций проверяются на корневом пути',
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

test('E2E-04: черновик, публикация, чтение участником и снятие (без обсуждения — этап 9)', async ({
  page,
  browser,
}) => {
  const [officer, member, admin] = await Promise.all([
    createMember('officer'),
    createMember('member'),
    createMember('admin'),
  ])
  const title = unique('Гайд по осаде')

  // Офицер пишет черновик с форматированием и скрывает подпись.
  await signInUi(page, officer.email)
  await expectSignedIn(page)
  await page.goto('./#/publications/new')
  await page.getByLabel('Заголовок').fill(title)
  const editor = page.getByRole('textbox', { name: 'Содержимое' })
  await editor.click()
  await editor.pressSequentially('Сбор у портала')
  await editor.press('ControlOrMeta+a')
  await page.getByRole('button', { name: 'Жирный' }).click()
  await page.getByText('Показывать читателям подпись автора').click()
  await page.getByRole('button', { name: 'Предпросмотр' }).click()
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  await page.getByRole('button', { name: 'Редактирование' }).click()
  await expect(page.getByLabel('Заголовок')).toHaveValue(title)
  expect(await hasHorizontalScroll(page)).toBe(false)
  await page.getByRole('button', { name: 'Сохранить черновик' }).click()
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  await expect(
    page.locator('main strong', { hasText: 'Сбор у портала' }),
  ).toBeVisible()
  const draftUrl = page.url()

  // Участник черновика не видит ни в ленте, ни по прямой ссылке.
  const memberPage = await signedInPage(browser, member.email)
  await revisit(memberPage, './#/publications')
  await expect(memberPage.getByRole('link', { name: title })).toHaveCount(0)
  await revisit(memberPage, draftUrl.replace(/^.*#/, './#'))
  await expect(memberPage.getByText('Материал не найден')).toBeVisible()

  // Офицер публикует.
  await page.getByRole('link', { name: 'Редактировать' }).click()
  await page.getByRole('button', { name: 'Опубликовать' }).click()
  await expect(page.getByText('Черновик', { exact: true })).toHaveCount(0)

  // Участник читает без кнопок управления и без скрытой подписи.
  await revisit(memberPage, './#/publications')
  await memberPage.getByRole('link', { name: title }).click()
  await expect(memberPage.getByRole('heading', { name: title })).toBeVisible()
  await expect(
    memberPage.getByRole('link', { name: 'Редактировать' }),
  ).toHaveCount(0)
  await expect(memberPage.getByText(`Автор: ${officer.nickname}`)).toHaveCount(
    0,
  )
  expect(await hasHorizontalScroll(memberPage)).toBe(false)

  // Администратор видит автора, несмотря на скрытую подпись (PUB-07).
  const adminPage = await signedInPage(browser, admin.email)
  await revisit(adminPage, draftUrl.replace(/^.*#/, './#'))
  await expect(adminPage.getByText(`Автор: ${officer.nickname}`)).toBeVisible()

  // Поиск находит материал, сброс возвращает ленту (PUB-09).
  await revisit(memberPage, './#/publications')
  await memberPage.getByRole('searchbox', { name: 'Поиск' }).fill('ОСАДЕ')
  await memberPage.getByRole('button', { name: 'Найти' }).click()
  await expect(memberPage.getByRole('link', { name: title })).toBeVisible()
  await memberPage
    .getByRole('searchbox', { name: 'Поиск' })
    .fill('нет-такого-материала')
  await memberPage.getByRole('button', { name: 'Найти' }).click()
  await expect(memberPage.getByText('Ничего не найдено')).toBeVisible()

  // Снятие с публикации скрывает материал от читателей.
  await page.getByRole('button', { name: 'Снять с публикации' }).click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Снять с публикации' })
    .click()
  await expect(page.getByText('Черновик', { exact: true })).toBeVisible()
  await revisit(memberPage, './#/publications')
  await expect(memberPage.getByRole('link', { name: title })).toHaveCount(0)
})

test('опасное содержимое отклоняется сервером, а участник не может создать публикацию', async () => {
  const [officer, member] = await Promise.all([
    createMember('officer'),
    createMember('member'),
  ])
  const officerToken = await accessToken(officer.email)
  const unsafe = {
    status: 'published',
    category: 'news',
    title: 'XSS',
    summary: null,
    showAuthor: true,
    discussionEnabled: false,
    attachments: [],
  }
  for (const content of [
    '<img src=x onerror=alert(1)>',
    {
      type: 'doc',
      content: [{ type: 'iframe', attrs: { src: 'https://evil.example' } }],
    },
    {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'x',
              marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
            },
          ],
        },
      ],
    },
    {
      type: 'doc',
      content: [
        {
          type: 'video',
          attrs: { provider: 'youtube', videoId: '"><script>' },
        },
      ],
    },
  ]) {
    const response = await callApi('publications/save', officerToken, {
      ...unsafe,
      content,
    })
    expect(response.status).toBe(422)
  }
  const memberToken = await accessToken(member.email)
  const denied = await callApi('publications/save', memberToken, {
    ...unsafe,
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'т' }] }],
    },
  })
  expect(denied.status).toBe(403)
})
