import type { AppDeps, TelegramDeps } from '../app.ts'
import { profileRepository } from '../account/repository.ts'
import {
  loadActor,
  requireRole,
  type Actor,
  type ProfiledActor,
} from '../auth/actor.ts'
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
import { eventRepository } from '../events/repository.ts'
import { saveAnswer } from '../events/service.ts'
import { editMessage } from './announcements.ts'
import { parseCallbackData, type CallbackAction } from './callback-data.ts'
import { BOT_TEXTS, CALLBACK_TEXTS } from './messages.ts'
import { eventMessage } from './render.ts'
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

/** Telegram настроен на сервере, иначе `telegram_unavailable`. */
export function requireTelegram(deps: AppDeps): TelegramDeps {
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
      await onCallback(deps, telegram, callback)
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

/**
 * Нажатие кнопки анонса (TGM-18–TGM-23). Всегда закрывает индикатор;
 * отказ — всплывающее пояснение и снятие кнопок с нажатого сообщения.
 */
async function onCallback(
  deps: AppDeps,
  telegram: TelegramDeps,
  callback: TelegramCallbackQuery,
) {
  let alert: string | undefined = CALLBACK_TEXTS.failed
  try {
    const action = parseCallbackData(callback.data ?? '')
    const message = callback.message
    if (!message) {
      alert = CALLBACK_TEXTS.stale
      return
    }
    const target = { chatId: message.chat.id, messageId: message.message_id }
    alert = action
      ? await pressButton(deps, telegram, callback.from.id, target, action)
      : CALLBACK_TEXTS.stale
    if (alert) {
      await telegram.gateway.editKeyboard(target.chatId, target.messageId, null)
    }
  } finally {
    await telegram.gateway.answerCallback(callback.id, alert)
  }
}

/** Результат нажатия: `undefined` — принято, иначе текст отказа. */
async function pressButton(
  deps: AppDeps,
  telegram: TelegramDeps,
  telegramUserId: number,
  target: { chatId: number; messageId: number },
  action: CallbackAction,
): Promise<string | undefined> {
  const link = await telegramRepository.linkByTelegram(deps.db, telegramUserId)
  if (!link) {
    return CALLBACK_TEXTS.notLinked
  }
  const event = await eventRepository.find(deps.db, action.eventId)
  if (!event) {
    return CALLBACK_TEXTS.deleted
  }
  // Кнопки принимаются только с активного сообщения своего события (TGM-22).
  const active = await telegramRepository.activeMessage(
    deps.db,
    action.eventId,
    link.userId,
  )
  if (
    !active ||
    active.chatId !== target.chatId ||
    active.messageId !== target.messageId
  ) {
    return CALLBACK_TEXTS.stale
  }
  let viewer: ProfiledActor
  try {
    viewer = requireRole(await loadActor(deps.db, link.userId), INTERNAL_ROLES)
  } catch {
    return CALLBACK_TEXTS.forbidden
  }
  if (event.closed_at) {
    return CALLBACK_TEXTS.closed
  }
  if (parseTimestamp(event.starts_at) <= deps.now()) {
    return CALLBACK_TEXTS.started
  }

  if (action.kind === 'answer') {
    try {
      await saveAnswer(deps, viewer, action.eventId, action.answer)
    } catch (error) {
      return refusalText(error)
    }
    const { html, keyboard } = eventMessage(
      active,
      action.eventId,
      action.answer,
    )
    await editMessage(deps, telegram, link.userId, target, html, keyboard)
    return undefined
  }
  // «Изменить решение»: ответ не меняется до нового выбора (Q-76).
  const answers = await eventRepository.answersOf(
    deps.db,
    [action.eventId],
    link.userId,
  )
  const { html, keyboard } = eventMessage(
    active,
    action.eventId,
    answers.get(action.eventId) ?? null,
    true,
  )
  await editMessage(deps, telegram, link.userId, target, html, keyboard)
  return undefined
}

/** Отказ `saveAnswer` при гонке с закрытием, началом или удалением события. */
function refusalText(error: unknown) {
  if (!(error instanceof ApiError)) {
    throw error
  }
  if (error.code === 'not_found') {
    return CALLBACK_TEXTS.deleted
  }
  if (error.code === 'forbidden') {
    return CALLBACK_TEXTS.forbidden
  }
  if (error.code === 'state_conflict') {
    return error.fields?.reason === 'closed'
      ? CALLBACK_TEXTS.closed
      : CALLBACK_TEXTS.started
  }
  throw error
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
