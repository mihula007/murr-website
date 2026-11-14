import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { sql } from 'kysely'
import type {
  AppDeps,
  TelegramDeps,
} from '../../supabase/functions/_shared/app.ts'
import { loadActor } from '../../supabase/functions/_shared/auth/actor.ts'
import { createAuthAdminGateway } from '../../supabase/functions/_shared/auth/admin-gateway.ts'
import { createStorageGateway } from '../../supabase/functions/_shared/storage/gateway.ts'
import type {
  InlineKeyboard,
  TelegramGateway,
} from '../../supabase/functions/_shared/telegram/gateway.ts'
import {
  createDb,
  type Db,
} from '../../supabase/functions/_shared/db/client.ts'
import type { AccessRole } from '../../supabase/functions/_shared/db/schema.ts'

export function env(name: string) {
  const value = process.env[`LOCAL_${name}`]
  if (!value) {
    throw new Error(`Нет LOCAL_${name}: запустите локальный Supabase`)
  }
  return value
}

export function testDb(): Db {
  return createDb(env('DB_URL'))
}

export function adminClient() {
  return createClient(env('API_URL'), env('SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Очищает прикладные данные; справочник классов остаётся. */
export async function resetAppData(db: Db) {
  await sql`truncate app.audit_log, app.application_equipment_links,
    app.join_applications, app.profiles, app.user_deletions restart identity cascade`.execute(
    db,
  )
}

export const TEST_PASSWORD = 'test-password-1'

export async function createAuthUser(options: { confirmed?: boolean } = {}) {
  const email = `user-${randomUUID()}@example.test`
  const { data, error } = await adminClient().auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: options.confirmed ?? true,
  })
  if (error || !data.user) {
    throw error ?? new Error('Не создан пользователь')
  }
  return { id: data.user.id, email }
}

let nicknameCounter = 0

/** Пользователь с профилем нужной роли (вставка в обход сервиса — фикстура). */
export async function createProfiledUser(db: Db, role: AccessRole) {
  const user = await createAuthUser()
  nicknameCounter += 1
  const nickname = `u${nicknameCounter}${randomUUID().slice(0, 4)}`
  await db
    .insertInto('app.profiles')
    .values({
      id: user.id,
      display_name: 'Тест',
      game_nickname: nickname,
      class_id: 1,
      access_role: role,
      is_primary_admin: false,
    })
    .execute()
  return { ...user, nickname }
}

export async function signIn(email: string, password = TEST_PASSWORD) {
  const client = createClient(env('API_URL'), env('ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  })
  if (error || !data.session) {
    throw error ?? new Error('Нет сессии')
  }
  return data.session.access_token
}

export function testDeps(db: Db): AppDeps {
  return {
    db,
    storage: createStorageGateway(env('API_URL'), env('SERVICE_ROLE_KEY')),
    authAdmin: createAuthAdminGateway(env('API_URL'), env('SERVICE_ROLE_KEY')),
    now: () => new Date(),
  }
}

/** PNG 1×1 — минимальное корректное изображение. */
export const PNG_BYTES = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  ),
)

/** Загружает файл в папку пользователя тем же путём, что и браузер. */
export async function uploadAvatar(
  deps: AppDeps,
  userId: string,
  bytes: Uint8Array = PNG_BYTES,
  contentType = 'image/png',
) {
  const path = `${userId}/${randomUUID()}.png`
  const { token } = await deps.storage.createUploadUrl('avatars', path)
  const client = createClient(env('API_URL'), env('ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await client.storage
    .from('avatars')
    .uploadToSignedUrl(
      path,
      token,
      new Blob([bytes as BlobPart], { type: contentType }),
      {
        contentType,
      },
    )
  if (error) {
    throw error
  }
  return path
}

export function actorOf(db: Db, userId: string) {
  return loadActor(db, userId)
}

export const registration = (overrides: Record<string, unknown> = {}) => ({
  displayName: 'Анна',
  gameNickname: `n${randomUUID().slice(0, 6)}`,
  city: 'Москва',
  birthDate: '1995-04-12',
  classId: 1,
  about: 'Играю давно, хочу в клан.',
  equipmentLinks: ['https://example.com/gear.png'],
  ...overrides,
})

/** Вызов фальшивого шлюза Telegram: метод и параметры. */
export type TelegramCall = {
  method:
    'sendHtml' | 'sendText' | 'editHtml' | 'editKeyboard' | 'answerCallback'
  chatId?: number
  messageId?: number
  text?: string
  keyboard?: InlineKeyboard | null
  callbackId?: string
}

/**
 * Фальшивый шлюз Bot API для серверных тестов: записывает вызовы, выдаёт
 * номера сообщений; `blocked` — чаты, остановившие бота.
 */
export function fakeTelegram() {
  const calls: TelegramCall[] = []
  const blocked = new Set<number>()
  let nextMessageId = 100
  const gateway: TelegramGateway = {
    async sendHtml(chatId, text, keyboard) {
      calls.push({
        method: 'sendHtml',
        chatId,
        text,
        keyboard: keyboard ?? null,
      })
      return blocked.has(chatId)
        ? { status: 'blocked' }
        : { status: 'ok', messageId: nextMessageId++ }
    },
    async sendText(chatId, text) {
      calls.push({ method: 'sendText', chatId, text })
      return blocked.has(chatId)
        ? { status: 'blocked' }
        : { status: 'ok', messageId: nextMessageId++ }
    },
    async editHtml(chatId, messageId, text, keyboard) {
      calls.push({ method: 'editHtml', chatId, messageId, text, keyboard })
      return blocked.has(chatId) ? 'blocked' : 'ok'
    },
    async editKeyboard(chatId, messageId, keyboard) {
      calls.push({ method: 'editKeyboard', chatId, messageId, keyboard })
      return blocked.has(chatId) ? 'blocked' : 'ok'
    },
    async answerCallback(callbackId, text) {
      calls.push({
        method: 'answerCallback',
        callbackId,
        ...(text ? { text } : {}),
      })
    },
  }
  const telegram: TelegramDeps = {
    gateway,
    botUsername: 'murr_test_bot',
    webhookSecret: TELEGRAM_TEST_SECRET,
    siteUrl: 'https://murr.test/',
  }
  return { telegram, calls, blocked }
}

export const TELEGRAM_TEST_SECRET = 'test-webhook-secret-0123456789abcdef'

/** Заголовки вебхука с секретом (или без него). */
export function webhookHeaders(secret: string | null = TELEGRAM_TEST_SECRET) {
  return new Headers(
    secret === null ? {} : { 'x-telegram-bot-api-secret-token': secret },
  )
}
