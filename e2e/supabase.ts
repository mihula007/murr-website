import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { expect, type Page } from '@playwright/test'
import postgres from 'postgres'

type Status = {
  API_URL: string
  DB_URL: string
  ANON_KEY: string
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

function anonClient() {
  const { API_URL, ANON_KEY } = localStack()
  return createClient(API_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Токен доступа пользователя для прямых вызовов функции `api`. */
export async function accessToken(email: string, password = PASSWORD) {
  const { data, error } = await anonClient().auth.signInWithPassword({
    email,
    password,
  })
  if (error || !data.session) throw error ?? new Error('Нет сессии')
  return data.session.access_token
}

/** Прямой вызов операции `api` с токеном пользователя (без интерфейса). */
export async function callApi(route: string, token: string, body: object = {}) {
  const { API_URL, ANON_KEY } = localStack()
  const response = await fetch(`${API_URL}/functions/v1/api/${route}`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  }
}

/**
 * Кандидат с заявкой тем же путём, что и через интерфейс, но без него:
 * регистрация в Auth, код из Mailpit, аватар и `account/complete-registration`.
 * Ускоряет сценарии на слабой машине; сам интерфейс регистрации проверяет
 * `auth.spec.ts`.
 */
export async function registerApplicant(
  links: string[] = ['https://example.com/gear.png'],
) {
  const email = uniqueEmail('applicant')
  const nickname = uniqueNickname()
  const client = anonClient()
  const sentAt = Date.now() - 1000
  const signUp = await client.auth.signUp({ email, password: PASSWORD })
  if (signUp.error) throw signUp.error
  const verified = await client.auth.verifyOtp({
    email,
    token: await latestCode(email, sentAt),
    type: 'signup',
  })
  if (verified.error || !verified.data.session) {
    throw verified.error ?? new Error('Нет сессии после кода')
  }
  const token = verified.data.session.access_token

  const upload = await callApi('account/avatar-upload', token, {
    contentType: 'image/png',
  })
  const uploaded = await client.storage
    .from('avatars')
    .uploadToSignedUrl(
      upload.body.path as string,
      upload.body.token as string,
      new Blob([readFileSync(AVATAR)], { type: 'image/png' }),
      { contentType: 'image/png' },
    )
  if (uploaded.error) throw uploaded.error

  const done = await callApi('account/complete-registration', token, {
    displayName: 'Анна',
    gameNickname: nickname,
    city: 'Москва',
    birthDate: '1995-04-12',
    classId: 7,
    about: 'Играю давно, хочу в клан.',
    equipmentLinks: links,
    avatarPath: upload.body.path,
  })
  if (done.status !== 200) {
    throw new Error(`Регистрация не завершена: ${JSON.stringify(done.body)}`)
  }
  return { id: verified.data.session.user.id, email, nickname }
}

/** Сегодняшняя дата по Москве в формате интерфейса (Q-08). */
export function moscowToday() {
  const [year, month, day] = new Date(Date.now() + 3 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
    .split('-')
  return `${day}.${month}.${year}`
}

/** События аудита по пользователю-цели, по порядку. */
export async function auditActions(targetUserId: string) {
  const rows = await sql(
    (db) => db<{ action: string }[]>`select action from app.audit_log
      where target_user_id = ${targetUserId} order by id`,
  )
  return rows.map((row) => row.action)
}
