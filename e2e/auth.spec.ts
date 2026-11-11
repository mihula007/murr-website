import { expect, test, type Page } from '@playwright/test'
import { hasHorizontalScroll, skipSplash } from './helpers'
import {
  AVATAR,
  createMember,
  expectSignedIn,
  latestCode,
  PASSWORD,
  signInUi,
  sql,
  uniqueEmail,
  uniqueNickname,
} from './supabase'

test.skip(
  ({ baseURL }) => Boolean(baseURL?.includes('/repository/')),
  'Сценарии аккаунта проверяются на корневом пути',
)

test.beforeEach(async ({ page }) => {
  // Сценарии ходят в Auth, Edge Functions и Mailpit — нужен запас времени.
  test.setTimeout(90_000)
  await skipSplash(page)
})

async function chooseClass(page: Page, name = 'Маг') {
  await page.getByRole('combobox', { name: 'Класс персонажа' }).click()
  await page.getByRole('option', { name, exact: true }).click()
}

async function fillCharacter(page: Page, nickname: string) {
  await page.locator('#reg-avatar').setInputFiles(AVATAR)
  await expect(page.getByAltText('Предпросмотр аватара')).toBeVisible({
    timeout: 15_000,
  })
  await page.getByLabel('Имя', { exact: true }).fill('Анна')
  await page.getByLabel('Игровой никнейм').fill(nickname)
  await page.getByLabel('Город').fill('Москва')
  await page.getByLabel('Дата рождения').fill('1995-04-12')
  await chooseClass(page)
  await page.getByLabel('Рассказ о себе').fill('Играю давно, хочу в клан.')
}

async function startRegistration(page: Page, email: string, nickname: string) {
  await page.goto('./#/register')
  await page.getByLabel('Логин (электронная почта)').fill(email)
  await page.getByLabel('Пароль', { exact: true }).fill(PASSWORD)
  await fillCharacter(page, nickname)
  await page.getByRole('button', { name: 'Добавить ссылку' }).click()
  await page.getByLabel('Ссылка 1').fill('https://example.com/gear.png')
  const sentAt = Date.now() - 1000
  await page.getByRole('button', { name: 'Создать учётную запись' }).click()
  await expect(page).toHaveURL(/#\/register\/verify/)
  return sentAt
}

async function enterCode(page: Page, email: string, after: number) {
  await page.getByLabel('Код из письма').fill(await latestCode(email, after))
  await page.getByRole('button', { name: 'Подтвердить' }).click()
}

async function applicationCount(email: string) {
  const [row] = await sql(
    (db) => db<{ count: string }[]>`select count(*) from app.join_applications a
      join auth.users u on u.id = a.applicant_id where u.email = ${email}`,
  )
  return Number(row?.count)
}

test('регистрация с кодом из письма создаёт заявку', async ({ page }) => {
  const email = uniqueEmail()
  const sentAt = await startRegistration(page, email, uniqueNickname())
  expect(await hasHorizontalScroll(page)).toBe(false)
  await enterCode(page, email, sentAt)
  await expect(page).toHaveURL(/#\/$/, { timeout: 30_000 })
  await expect(
    page.getByText('Заявка отправлена. Статус виден в личном кабинете.'),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Заявка отправлена' }),
  ).toBeVisible()

  await page.goto('./#/account')
  await expect(page.getByText('Привет, Анна!')).toBeVisible()
  await expect(
    page.getByText('Заявка получена и ожидает проверки офицером клана.'),
  ).toBeVisible()
  await page.goto('./#/events')
  await expect(page.getByRole('heading', { name: 'Нет доступа' })).toBeVisible()
  expect(await applicationCount(email)).toBe(1)
})

test('прерванная регистрация продолжается после входа', async ({
  page,
  browser,
}) => {
  const email = uniqueEmail()
  const nickname = uniqueNickname()
  const sentAt = await startRegistration(page, email, nickname)
  await page.close()

  // Новая вкладка без черновика и аватара в памяти.
  const context = await browser.newContext()
  const next = await context.newPage()
  await skipSplash(next)
  await signInUi(next, email)
  await expect(next).toHaveURL(/#\/register\/verify/)
  await enterCode(next, email, sentAt)
  await expect(next).toHaveURL(/#\/register\/complete/, { timeout: 30_000 })
  await expect(
    next.getByRole('heading', { name: 'Завершите регистрацию' }),
  ).toBeVisible({ timeout: 15_000 })
  await fillCharacter(next, nickname)
  await next.getByRole('button', { name: 'Отправить заявку' }).click()
  await expect(next).toHaveURL(/#\/$/, { timeout: 30_000 })
  expect(await applicationCount(email)).toBe(1)

  // Повторный вход не создаёт вторую заявку.
  await next.goto('./#/register/complete')
  await expect(next).toHaveURL(/#\/account/)
  expect(await applicationCount(email)).toBe(1)
  await context.close()
})

test('существующий email переводит ко входу', async ({ page }) => {
  const member = await createMember('member')
  await page.goto('./#/register')
  await page.getByLabel('Логин (электронная почта)').fill(member.email)
  await page.getByLabel('Пароль', { exact: true }).fill(PASSWORD)
  await fillCharacter(page, uniqueNickname())
  await page.getByRole('button', { name: 'Создать учётную запись' }).click()
  await expect(page).toHaveURL(/#\/login/)
  await expect(page.getByLabel('Email, указанный при регистрации')).toHaveValue(
    member.email,
  )
})

test('неверный пароль, вход и выход', async ({ page }) => {
  const member = await createMember('member')
  await signInUi(page, member.email, 'wrong-password')
  await expect(page.getByText('Неверный email или пароль.')).toBeVisible()
  await page.getByLabel('Пароль', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expectSignedIn(page)

  await page.goto('./#/account')
  await page.getByRole('button', { name: 'Выйти' }).click()
  await expect(page).toHaveURL(/#\/$/)
  await expect(
    page.getByRole('banner').getByRole('link', { name: 'Вход' }),
  ).toBeVisible()
  await page.goto('./#/roster')
  await expect(page.getByRole('heading', { name: 'Нет доступа' })).toBeVisible()
})

test('сессия сохраняется после перезагрузки', async ({ page }) => {
  const member = await createMember('member')
  await signInUi(page, member.email)
  await expectSignedIn(page)
  await page.reload()
  await expectSignedIn(page)
})

test('редактирование профиля и смена ника', async ({ page }) => {
  const member = await createMember('member')
  await signInUi(page, member.email)
  await expectSignedIn(page)
  await page.goto('./#/account')
  await page.getByText('Личная информация', { exact: true }).click()
  await page.getByRole('button', { name: 'Изменить личную информацию' }).click()
  const nickname = uniqueNickname()
  await page.getByLabel('Игровой никнейм').fill(nickname)
  await page.getByLabel('Город').fill('Казань')
  await page.getByRole('button', { name: 'Сохранить профиль' }).click()
  await expect(page.getByText('Личная информация сохранена')).toBeVisible()
  await expect(page.getByText(`${nickname} · Оборотень`)).toBeVisible()
  expect(await hasHorizontalScroll(page)).toBe(false)
})

test('смена пароля: старый перестаёт подходить', async ({ page }) => {
  const member = await createMember('reader')
  await signInUi(page, member.email)
  await expectSignedIn(page)
  await page.goto('./#/account')
  await page.getByText('Смена пароля', { exact: true }).click()
  await page.getByLabel('Текущий пароль').fill(PASSWORD)
  await page.getByLabel('Новый пароль', { exact: true }).fill('new-password-2')
  await page.getByLabel('Повторите новый пароль').fill('new-password-2')
  await page.getByRole('button', { name: 'Изменить пароль' }).click()
  await expect(page.getByText('Пароль изменён')).toBeVisible()

  await page.getByRole('button', { name: 'Выйти' }).click()
  await signInUi(page, member.email)
  await expect(page.getByText('Неверный email или пароль.')).toBeVisible()
  await signInUi(page, member.email, 'new-password-2')
  await expectSignedIn(page)
})

test('восстановление пароля кодом из письма', async ({ page }) => {
  const member = await createMember('applicant')
  await page.goto('./#/login')
  await page.getByRole('link', { name: 'Забыли пароль?' }).click()
  await page.getByLabel('Email').fill(member.email)
  const sentAt = Date.now() - 1000
  await page.getByRole('button', { name: 'Получить код' }).click()
  await page
    .getByLabel('Код из письма')
    .fill(await latestCode(member.email, sentAt))
  await page
    .getByLabel('Новый пароль', { exact: true })
    .fill('recovered-pass-3')
  await page.getByLabel('Повторите новый пароль').fill('recovered-pass-3')
  await page.getByRole('button', { name: 'Сменить пароль' }).click()
  await expect(page).toHaveURL(/#\/account/)
  await expect(page.getByText('Пароль изменён')).toBeVisible()
  await page.getByRole('button', { name: 'Выйти' }).click()
  await signInUi(page, member.email, 'recovered-pass-3')
  await expectSignedIn(page)
})

test('меню по ролям после входа', async ({ page, isMobile }) => {
  test.skip(
    isMobile,
    'Категории меню на мобильном проверяет навигационный тест',
  )
  for (const [role, categories] of [
    ['applicant', []],
    ['member', ['Клан', 'Сообщество']],
    ['officer', ['Клан', 'Сообщество', 'Управление']],
  ] as const) {
    const user = await createMember(role)
    await signInUi(page, user.email)
    await expectSignedIn(page)
    const banner = page.getByRole('banner')
    for (const category of ['Клан', 'Сообщество', 'Управление']) {
      await expect(
        banner.getByRole('button', { name: category, exact: true }),
      ).toHaveCount(
        (categories as readonly string[]).includes(category) ? 1 : 0,
      )
    }
    await page.goto('./#/account')
    await page.getByRole('button', { name: 'Выйти' }).click()
    await expect(banner.getByRole('link', { name: 'Вход' })).toBeVisible()
  }
})
