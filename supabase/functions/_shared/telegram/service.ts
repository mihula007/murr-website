import type { AppDeps, TelegramDeps } from '../app.ts'
import { profileRepository } from '../account/repository.ts'
import { requireRole, type Actor } from '../auth/actor.ts'
import {
  TELEGRAM_LINK_TTL_MINUTES,
  type TelegramLinkStart,
  type TelegramStatus,
} from '../contracts/telegram.ts'
import { parseTimestamp } from '../contracts/moscow-time.ts'
import { withTransaction } from '../db/client.ts'
import { isUniqueViolation } from '../db/errors.ts'
import { ApiError } from '../http/errors.ts'
import { INTERNAL_ROLES } from '../membership.ts'
import { BOT_TEXTS } from './messages.ts'
import { TELEGRAM_USER_CONSTRAINT, telegramRepository } from './repository.ts'
import {
  displayNameOf,
  startArgument,
  updateSchema,
  type TelegramCallbackQuery,
  type TelegramMessage,
} from './updates.ts'

/** Привязывают Telegram член, офицер и администратор (TGM-01, Q-88). */
export const TELEGRAM_LINKERS = INTERNAL_ROLES

function requireTelegram(deps: AppDeps): TelegramDeps {
  if (!deps.telegram) {
    throw new ApiError('telegram_unavailable')
  }
  return deps.telegram
}

const NOT_LINKED: Omit<TelegramStatus, 'configured'> = {
  linked: false,
  username: null,
  displayName: null,
  blocked: false,
}

/** Состояние привязки для кабинета (TGM-01, TGM-06, TGM-08). */
export async function telegramStatus(
  deps: AppDeps,
  actor: Actor,
): Promise<TelegramStatus> {
  const user = requireRole(actor, TELEGRAM_LINKERS)
  const configured = Boolean(deps.telegram)
  const link = await telegramRepository.linkByUser(deps.db, user.userId)
  if (!link) {
    return { configured, ...NOT_LINKED }
  }
  return {
    configured,
    linked: true,
    username: link.username,
    displayName: link.displayName,
    blocked: link.blockedAt !== null,
  }
}

/**
 * Одноразовая ссылка на бота (TGM-02, TGM-03): 32 случайных байта в
 * base64url — 43 символа, в пределах 64 символов параметра `start`. В БД —
 * только SHA-256; новый код заменяет прежний.
 */
export async function startTelegramLink(
  deps: AppDeps,
  actor: Actor,
): Promise<TelegramLinkStart> {
  const user = requireRole(actor, TELEGRAM_LINKERS)
  const telegram = requireTelegram(deps)
  const code = randomCode()
  const expiresAt = new Date(
    deps.now().getTime() + TELEGRAM_LINK_TTL_MINUTES * 60_000,
  ).toISOString()
  await telegramRepository.saveCode(deps.db, {
    userId: user.userId,
    codeHash: await sha256Hex(code),
    expiresAt,
  })
  return {
    url: `https://t.me/${telegram.botUsername}?start=${code}`,
    expiresAt,
  }
}

/** Отвязка из кабинета (TGM-07, Q-83): связь и неиспользованный код удаляются. */
export async function unlinkTelegram(
  deps: AppDeps,
  actor: Actor,
): Promise<TelegramStatus> {
  const user = requireRole(actor, TELEGRAM_LINKERS)
  await withTransaction(deps.db, async (tx) => {
    await telegramRepository.deleteLink(tx, user.userId)
    await telegramRepository.deleteCode(tx, user.userId)
  })
  return telegramStatus(deps, user)
}

/**
 * Вебхук Bot API. Неверный секрет — `not_found` (маршрут не раскрывается).
 * После проверки секрета ответ всегда 200: при ошибке Telegram повторил бы
 * апдейт, поэтому сбой только логируется.
 */
export async function handleTelegramWebhook(
  deps: AppDeps,
  headers: Headers,
  body: unknown,
): Promise<Record<string, never>> {
  const telegram = deps.telegram
  if (
    !telegram ||
    !sameSecret(
      headers.get('x-telegram-bot-api-secret-token') ?? '',
      telegram.webhookSecret,
    )
  ) {
    throw new ApiError('not_found')
  }
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return {}
  }
  try {
    const { message, callback_query: callback } = parsed.data
    if (message) {
      await onMessage(deps, telegram, message)
    } else if (callback) {
      await onCallback(telegram, callback)
    }
  } catch (error) {
    console.error('Апдейт Telegram не обработан', error)
  }
  return {}
}

/** Личные сообщения: `/start <код>` привязывает, остальное — пояснение (TGM-09). */
async function onMessage(
  deps: AppDeps,
  telegram: TelegramDeps,
  message: TelegramMessage,
) {
  const from = message.from
  if (message.chat.type !== 'private' || !from || from.is_bot) {
    return
  }
  const chatId = message.chat.id
  const code = startArgument(message.text)
  if (code) {
    const reply = await linkByCode(deps, message, code)
    await telegram.gateway.sendText(chatId, reply)
    return
  }
  const link = await telegramRepository.linkByTelegram(deps.db, from.id)
  if (!link) {
    await telegram.gateway.sendText(
      chatId,
      BOT_TEXTS.helpGuest(telegram.siteUrl),
    )
    return
  }
  // Любое сообщение привязанного: свежее имя и снятие отметки блокировки (TGM-08).
  await telegramRepository.touchLink(deps.db, from.id, {
    chatId,
    username: from.username ?? null,
    displayName: displayNameOf(from),
  })
  const profile = await profileRepository.findById(deps.db, link.userId)
  await telegram.gateway.sendText(
    chatId,
    profile
      ? BOT_TEXTS.helpLinked(profile.game_nickname)
      : BOT_TEXTS.helpGuest(telegram.siteUrl),
  )
}

/** Привязка по коду (TGM-02–TGM-04): ответ бота — результат. */
async function linkByCode(
  deps: AppDeps,
  message: TelegramMessage,
  code: string,
): Promise<string> {
  const from = message.from!
  const codeHash = await sha256Hex(code)
  const now = deps.now()
  try {
    return await withTransaction(deps.db, async (tx) => {
      const taken = await telegramRepository.takeCode(tx, codeHash)
      if (!taken || parseTimestamp(taken.expires_at) <= now) {
        return BOT_TEXTS.linkInvalid
      }
      const existing = await telegramRepository.linkByTelegram(tx, from.id)
      if (existing && existing.userId !== taken.user_id) {
        return BOT_TEXTS.linkTaken
      }
      const profile = await profileRepository.findById(tx, taken.user_id)
      if (!profile) {
        return BOT_TEXTS.linkInvalid
      }
      await telegramRepository.saveLink(
        tx,
        {
          userId: taken.user_id,
          telegramUserId: from.id,
          chatId: message.chat.id,
          username: from.username ?? null,
          displayName: displayNameOf(from),
        },
        now.toISOString(),
      )
      return BOT_TEXTS.linked(profile.game_nickname)
    })
  } catch (error) {
    // Параллельная привязка того же Telegram к другому аккаунту (TGM-04).
    if (isUniqueViolation(error, TELEGRAM_USER_CONSTRAINT)) {
      return BOT_TEXTS.linkTaken
    }
    throw error
  }
}

/** Нажатия кнопок — задача 4; пока закрывается индикатор нажатия. */
async function onCallback(
  telegram: TelegramDeps,
  callback: TelegramCallbackQuery,
) {
  await telegram.gateway.answerCallback(callback.id)
}

function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  )
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

/** Сравнение секрета за время, не зависящее от совпавшего префикса. */
function sameSecret(given: string, expected: string) {
  const a = new TextEncoder().encode(given)
  const b = new TextEncoder().encode(expected)
  let diff = a.length ^ b.length
  for (let i = 0; i < b.length; i++) {
    diff |= (a[i] ?? 0) ^ b[i]!
  }
  return diff === 0
}
