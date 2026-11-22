import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { sql } from 'kysely'
import type {
  AppDeps,
  MaxDeps,
  TelegramDeps,
  VkDeps,
} from '../../supabase/functions/_shared/app.ts'
import type {
  VkGateway,
  VkKeyboard,
} from '../../supabase/functions/_shared/vk/gateway.ts'
import type {
  MaxGateway,
  MaxKeyboard,
} from '../../supabase/functions/_shared/max/gateway.ts'
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
import { OFFICER_PERMISSION_CODES } from '../../supabase/functions/_shared/contracts/officer-permissions.ts'

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
export async function createProfiledUser(
  db: Db,
  role: AccessRole,
  options: { officerPermissions?: readonly string[] } = {},
) {
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
  if (role === 'officer') {
    const permissions = options.officerPermissions ?? OFFICER_PERMISSION_CODES
    if (permissions.length > 0) {
      await db
        .insertInto('app.officer_permissions')
        .values(
          permissions.map((permission_code) => ({
            officer_id: user.id,
            permission_code,
          })),
        )
        .execute()
    }
  }
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
    | 'sendHtml'
    | 'sendPhoto'
    | 'sendText'
    | 'editHtml'
    | 'editKeyboard'
    | 'answerCallback'
  chatId?: number
  messageId?: number
  text?: string
  keyboard?: InlineKeyboard | null
  callbackId?: string
  /** Картинка отправки или правка подписи — только если есть (TGM-27). */
  photo?: string
  caption?: true
}

/**
 * Фальшивый шлюз Bot API для серверных тестов: записывает вызовы, выдаёт
 * номера сообщений; `blocked` — чаты, остановившие бота.
 */
export function fakeTelegram() {
  const calls: TelegramCall[] = []
  const blocked = new Set<number>()
  const controls: {
    beforeSendHtml: (() => Promise<void>) | null
    beforeEditHtml: (() => Promise<void>) | null
  } = {
    beforeSendHtml: null,
    beforeEditHtml: null,
  }
  /** Картинки, которые «не отправляются» (TGM-27). */
  const failingPhotos = new Set<string>()
  let nextMessageId = 100
  const gateway: TelegramGateway = {
    async sendPhoto(chatId, photo) {
      calls.push({ method: 'sendPhoto', chatId, photo })
      if (blocked.has(chatId)) {
        return { status: 'blocked' }
      }
      if (failingPhotos.has(photo)) {
        return { status: 'failed' }
      }
      return {
        status: 'ok',
        messageId: nextMessageId++,
        photoId: `file-${photo.split('/').at(-1)}`,
      }
    },
    async sendHtml(chatId, text, keyboard, photo) {
      calls.push({
        method: 'sendHtml',
        chatId,
        text,
        keyboard: keyboard ?? null,
        ...(photo ? { photo } : {}),
      })
      if (blocked.has(chatId)) {
        return { status: 'blocked' }
      }
      await controls.beforeSendHtml?.()
      if (photo && failingPhotos.has(photo)) {
        return { status: 'failed' }
      }
      const messageId = nextMessageId++
      return photo
        ? {
            status: 'ok',
            messageId,
            photoId: `file-${photo.split('/').at(-1)}`,
          }
        : { status: 'ok', messageId }
    },
    async sendText(chatId, text) {
      calls.push({ method: 'sendText', chatId, text })
      return blocked.has(chatId)
        ? { status: 'blocked' }
        : { status: 'ok', messageId: nextMessageId++ }
    },
    async editHtml(chatId, messageId, text, keyboard, caption) {
      calls.push({
        method: 'editHtml',
        chatId,
        messageId,
        text,
        keyboard,
        ...(caption ? { caption: true as const } : {}),
      })
      await controls.beforeEditHtml?.()
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
  return { telegram, calls, blocked, failingPhotos, controls }
}

export const TELEGRAM_TEST_SECRET = 'test-webhook-secret-0123456789abcdef'

/** Заголовки вебхука с секретом (или без него). */
export function webhookHeaders(secret: string | null = TELEGRAM_TEST_SECRET) {
  return new Headers(
    secret === null ? {} : { 'x-telegram-bot-api-secret-token': secret },
  )
}

/** Вызов фальшивого шлюза MAX: метод и параметры. */
export type MaxCall = {
  method:
    | 'uploadImage'
    | 'sendHtml'
    | 'sendText'
    | 'editHtml'
    | 'removeKeyboard'
    | 'answerCallback'
  userId?: number
  messageId?: string
  text?: string
  keyboard?: MaxKeyboard | null
  callbackId?: string
  /** Адрес загружаемой или токен отправленной картинки (MAX-13). */
  image?: string
}

/**
 * Фальшивый шлюз MAX для серверных тестов: записывает вызовы, выдаёт
 * строковые `mid`; `blocked` — пользователи, остановившие бота.
 */
export function fakeMax() {
  const calls: MaxCall[] = []
  const blocked = new Set<number>()
  /** `mid` → получатель, чтобы правка остановившему бота давала `blocked`. */
  const owners = new Map<string, number>()
  let next = 1
  const send = (userId: number) => {
    if (blocked.has(userId)) {
      return { status: 'blocked' as const }
    }
    const messageId = `mid.${next++}`
    owners.set(messageId, userId)
    return { status: 'ok' as const, messageId }
  }
  const editResult = (messageId: string) =>
    blocked.has(owners.get(messageId) ?? -1) ? 'blocked' : 'ok'
  /** Картинка не загружается — `uploadImage` вернёт null. */
  const upload = { fails: false }
  const gateway: MaxGateway = {
    async uploadImage(url) {
      calls.push({ method: 'uploadImage', image: url })
      return upload.fails ? null : `token-${url.split('/').at(-1)}`
    },
    async sendHtml(userId, text, keyboard, image) {
      calls.push({
        method: 'sendHtml',
        userId,
        text,
        keyboard: keyboard ?? null,
        ...(image ? { image } : {}),
      })
      return send(userId)
    },
    async sendText(userId, text) {
      calls.push({ method: 'sendText', userId, text })
      return send(userId)
    },
    async editHtml(messageId, text, keyboard, image) {
      calls.push({
        method: 'editHtml',
        messageId,
        text,
        keyboard,
        ...(image ? { image } : {}),
      })
      return editResult(messageId)
    },
    async removeKeyboard(messageId, image) {
      calls.push({
        method: 'removeKeyboard',
        messageId,
        ...(image ? { image } : {}),
      })
      return editResult(messageId)
    },
    async answerCallback(callbackId, text) {
      calls.push({
        method: 'answerCallback',
        callbackId,
        ...(text ? { text } : {}),
      })
    },
  }
  const max: MaxDeps = {
    gateway,
    botUsername: 'murr_test_max_bot',
    webhookSecret: MAX_TEST_SECRET,
    siteUrl: 'https://murr.test/',
  }
  return { max, calls, blocked, upload }
}

export const MAX_TEST_SECRET = 'test-max-secret-0123456789abcdef'

/** Заголовки вебхука MAX с секретом (или без него). */
export function maxWebhookHeaders(secret: string | null = MAX_TEST_SECRET) {
  return new Headers(secret === null ? {} : { 'x-max-bot-api-secret': secret })
}

/** Вызов фальшивого шлюза ВКонтакте: метод и параметры. */
export type VkCall = {
  method: 'uploadPhoto' | 'send' | 'edit' | 'answerEvent'
  peerId?: number
  messageId?: number
  text?: string
  keyboard?: VkKeyboard | null
  eventId?: string
  /** Адрес загружаемой картинки или вложение `photo…` (VK-10). */
  attachment?: string
}

export const VK_TEST_GROUP_ID = 777
export const VK_TEST_SECRET = 'test-vk-secret-0123456789'

/**
 * Фальшивый шлюз ВКонтакте: записывает вызовы, выдаёт
 * `conversation_message_id`; `blocked` — запретившие сообщения,
 * `expired` — сообщения, которые нельзя править (VK-08).
 */
export function fakeVk() {
  const calls: VkCall[] = []
  const blocked = new Set<number>()
  const expired = new Set<number>()
  let next = 1
  /** Картинка не загружается — `uploadPhoto` вернёт null. */
  const upload = { fails: false }
  const gateway: VkGateway = {
    async uploadPhoto(url) {
      calls.push({ method: 'uploadPhoto', attachment: url })
      return upload.fails ? null : `photo-${VK_TEST_GROUP_ID}_1_key`
    },
    async send(peerId, text, keyboard, attachment) {
      calls.push({
        method: 'send',
        peerId,
        text,
        keyboard: keyboard ?? null,
        ...(attachment ? { attachment } : {}),
      })
      return blocked.has(peerId)
        ? { status: 'blocked' }
        : { status: 'ok', messageId: next++ }
    },
    async edit(peerId, messageId, text, keyboard, attachment) {
      calls.push({
        method: 'edit',
        peerId,
        messageId,
        text,
        keyboard,
        ...(attachment ? { attachment } : {}),
      })
      if (blocked.has(peerId)) {
        return 'blocked'
      }
      return expired.has(messageId) ? 'gone' : 'ok'
    },
    async answerEvent(event, text) {
      calls.push({
        method: 'answerEvent',
        eventId: event.eventId,
        peerId: event.peerId,
        ...(text ? { text } : {}),
      })
    },
    async profile(userId) {
      return { firstName: 'Анна', lastName: null, screenName: `id${userId}` }
    },
    async confirmationCode() {
      return 'confirm-123'
    },
  }
  const vk: VkDeps = {
    gateway,
    groupId: VK_TEST_GROUP_ID,
    groupName: 'murr_test',
    callbackSecret: VK_TEST_SECRET,
    siteUrl: 'https://murr.test/',
  }
  return { vk, calls, blocked, expired, upload }
}
