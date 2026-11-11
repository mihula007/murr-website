import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { expect, type Page } from '@playwright/test'
import postgres from 'postgres'

type Status = {
  API_URL: string
  DB_URL: string
  SERVICE_ROLE_KEY: string
  MAILPIT_URL: string
}

let cached: Status | undefined

/** Адреса и ключи локального стека — из `supabase status`, не из Git. */
export function localStack(): Status {
  cached ??= JSON.parse(
    // Через оболочку: на Windows npx — это npx.cmd.
    execSync('npx supabase status -o json', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }),
  ) as Status
  return cached
}

export const PASSWORD = 'e2e-password-1'
export const AVATAR = 'src/assets/murrclan-eye.png'

export function uniqueEmail(prefix = 'e2e') {
  return `${prefix}-${randomUUID().slice(0, 8)}@example.test`
}

export function uniqueNickname() {
  return `e${randomUUID().slice(0, 7)}`
}

/** Последний шестизначный код из письма на адрес в Mailpit. */
export async function latestCode(email: string, after = 0) {
  const { MAILPIT_URL } = localStack()
  let code: string | undefined
  await expect
    .poll(
      async () => {
        const response = await fetch(
          `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`,
        )
        const data = (await response.json()) as {
          messages: { Created: string; Snippet: string }[]
        }
        const message = data.messages.find(
          (item) => Date.parse(item.Created) >= after,
        )
        code = message?.Snippet.match(/\b(\d{6})\b/)?.[1]
        return code
      },
      { timeout: 20_000 },
    )
    .toBeTruthy()
  return code as string
}

export async function sql<T>(
  run: (db: postgres.Sql) => Promise<T>,
): Promise<T> {
  const db = postgres(localStack().DB_URL, { prepare: false, max: 1 })
  try {
    return await run(db)
  } finally {
    await db.end()
  }
}

/** Подтверждённый пользователь с профилем роли — фикстура в обход регистрации. */
export async function createMember(role: string) {
  const { API_URL, SERVICE_ROLE_KEY } = localStack()
  const admin = createClient(API_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const email = uniqueEmail(role)
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  })
  if (error || !data.user) throw error ?? new Error('Не создан пользователь')
  const nickname = uniqueNickname()
  await sql(
    (db) => db`insert into app.profiles
      (id, display_name, game_nickname, class_id, access_role, city)
      values (${data.user.id}, 'Тест', ${nickname}, 1, ${role}, 'Москва')`,
  )
  return { id: data.user.id, email, nickname }
}

export async function signInUi(page: Page, email: string, password = PASSWORD) {
  await page.goto('./#/login')
  await page.getByLabel('Email, указанный при регистрации').fill(email)
  await page.getByLabel('Пароль', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
}

/** Ждёт, что пользователь вошёл и переход после входа завершён. */
export async function expectSignedIn(page: Page) {
  await expect(
    page.getByRole('banner').getByRole('link', { name: 'Аккаунт' }),
  ).toBeVisible({ timeout: 15_000 })
  // Вход завершён, когда приложение само ушло со страницы входа.
  await expect(page).not.toHaveURL(/#\/login/, { timeout: 15_000 })
}
