import type { AppDeps, MaxDeps } from '../app.ts'
import { profileRepository } from '../account/repository.ts'
import {
  loadActor,
  requireRole,
  type Actor,
  type ProfiledActor,
} from '../auth/actor.ts'
import { runInBackground } from '../background.ts'
import {
  MAX_LINK_TTL_MINUTES,
  type MaxLinkStart,
  type MaxStatus,
} from '../contracts/max.ts'
import { EVENT_ANSWER_LABELS } from '../contracts/events.ts'
import { parseTimestamp } from '../contracts/moscow-time.ts'
import { withTransaction } from '../db/client.ts'
import { isUniqueViolation } from '../db/errors.ts'
import { eventRepository } from '../events/repository.ts'
import { saveAnswer } from '../events/service.ts'
import { ApiError } from '../http/errors.ts'
import { INTERNAL_ROLES } from '../membership.ts'
import {
  parseCallbackData,
  type CallbackAction,
} from '../messenger/callback-data.ts'
import { randomCode, sameSecret, sha256Hex } from '../messenger/link-code.ts'
import { syncEventMessages } from '../messenger/sync.ts'
import { editMaxMessage } from './announcements.ts'
import { MAX_BOT_TEXTS, MAX_CALLBACK_TEXTS } from './messages.ts'
import { maxEventMessage } from './render.ts'
import { MAX_USER_CONSTRAINT, maxRepository } from './repository.ts'
import {
  displayNameOf,
  updateSchema,
  usernameOf,
  type MaxUpdate,
  type MaxUser,
} from './updates.ts'

/** Привязывают MAX член, офицер и администратор (MAX-01, как TGM-01). */
export const MAX_LINKERS = INTERNAL_ROLES

/** MAX настроен на сервере, иначе `max_unavailable`. */
export function requireMax(deps: AppDeps): MaxDeps {
  if (!deps.max) {
    throw new ApiError('max_unavailable')
  }
  return deps.max
}

/** Состояние привязки для кабинета (MAX-01, MAX-03). */
export async function maxStatus(
  deps: AppDeps,
  actor: Actor,
): Promise<MaxStatus> {
  const user = requireRole(actor, MAX_LINKERS)
  const configured = Boolean(deps.max)
  const link = await maxRepository.linkByUser(deps.db, user.userId)
  if (!link) {
    return {
      configured,
      linked: false,
      username: null,
      displayName: null,
      blocked: false,
    }
  }
  return {
    configured,
    linked: true,
    username: link.username,
    displayName: link.displayName,
    blocked: link.blockedAt !== null,
  }
}

/** Одноразовая ссылка `max.ru/<бот>?start=<код>` (MAX-01): в БД — хеш. */
export async function startMaxLink(
  deps: AppDeps,
  actor: Actor,
): Promise<MaxLinkStart> {
  const user = requireRole(actor, MAX_LINKERS)
  const max = requireMax(deps)
  const code = randomCode()
  const expiresAt = new Date(
    deps.now().getTime() + MAX_LINK_TTL_MINUTES * 60_000,
  ).toISOString()
  await maxRepository.saveCode(deps.db, {
    userId: user.userId,
    codeHash: await sha256Hex(code),
    expiresAt,
  })
  return { url: `https://max.ru/${max.botUsername}?start=${code}`, expiresAt }
}

/** Отвязка из кабинета: связь и неиспользованный код удаляются. */
export async function unlinkMax(
  deps: AppDeps,
  actor: Actor,
): Promise<MaxStatus> {
  const user = requireRole(actor, MAX_LINKERS)
  await withTransaction(deps.db, async (tx) => {
    await maxRepository.deleteLink(tx, user.userId)
    await maxRepository.deleteCode(tx, user.userId)
  })
  return maxStatus(deps, user)
}

/**
 * Вебхук MAX. Неверный секрет — `not_found`. После проверки секрета ответ
 * всегда 200: иначе MAX повторяет апдейт (до 8 часов), сбой только логируется.
 */
export async function handleMaxWebhook(
  deps: AppDeps,
  headers: Headers,
  body: unknown,
): Promise<Record<string, never>> {
  const max = deps.max
  if (
    !max ||
    !sameSecret(headers.get('x-max-bot-api-secret') ?? '', max.webhookSecret)
  ) {
    throw new ApiError('not_found')
  }
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return {}
  }
  try {
    await onUpdate(deps, max, parsed.data)
  } catch (error) {
    console.error('Апдейт MAX не обработан', error)
  }
  return {}
}

async function onUpdate(deps: AppDeps, max: MaxDeps, update: MaxUpdate) {
  switch (update.update_type) {
    case 'bot_started':
      return onStart(deps, max, update.user, update.chat_id, update.payload)
    case 'bot_stopped':
      // Остановленный бот: анонсы не отправляются (MAX-03).
      return maxRepository.markBlockedByMax(
        deps.db,
        update.user.user_id,
        deps.now().toISOString(),
      )
    case 'message_created': {
      const { sender, recipient } = update.message
      if (
        !sender ||
        sender.is_bot ||
        recipient.chat_type !== 'dialog' ||
        recipient.chat_id == null
      ) {
        return
      }
      // Привязка — только `bot_started` по ссылке: в ответ на текст бот
      // поясняет, иначе код из `/start <код>` пришёл бы дважды.
      return onStart(deps, max, sender, recipient.chat_id, null)
    }
    case 'message_callback':
      return onCallback(deps, max, update)
  }
}

/** «Начать» по ссылке с кодом привязывает; иначе — пояснение (TGM-09). */
async function onStart(
  deps: AppDeps,
  max: MaxDeps,
  user: MaxUser,
  chatId: number,
  code: string | null | undefined,
) {
  if (user.is_bot) {
    return
  }
  if (code) {
    const reply = await linkByCode(deps, user, chatId, code)
    await max.gateway.sendText(user.user_id, reply)
    return
  }
  const link = await maxRepository.linkByMax(deps.db, user.user_id)
  if (!link) {
    await max.gateway.sendText(
      user.user_id,
      MAX_BOT_TEXTS.helpGuest(max.siteUrl),
    )
    return
  }
  // Обращение привязанного: свежее имя и снятие отметки остановки (MAX-03).
  await maxRepository.touchLink(deps.db, user.user_id, {
    chatId,
    username: usernameOf(user),
    displayName: displayNameOf(user),
  })
  const profile = await profileRepository.findById(deps.db, link.userId)
  await max.gateway.sendText(
    user.user_id,
    profile
      ? MAX_BOT_TEXTS.helpLinked(profile.game_nickname)
      : MAX_BOT_TEXTS.helpGuest(max.siteUrl),
  )
}

/** Привязка по коду (MAX-01): ответ бота — результат. */
async function linkByCode(
  deps: AppDeps,
  user: MaxUser,
  chatId: number,
  code: string,
): Promise<string> {
  const codeHash = await sha256Hex(code)
  const now = deps.now()
  try {
    return await withTransaction(deps.db, async (tx) => {
      const taken = await maxRepository.takeCode(tx, codeHash)
      if (!taken || parseTimestamp(taken.expires_at) <= now) {
        return MAX_BOT_TEXTS.linkInvalid
      }
      const existing = await maxRepository.linkByMax(tx, user.user_id)
      if (existing && existing.userId !== taken.user_id) {
        return MAX_BOT_TEXTS.linkTaken
      }
      const profile = await profileRepository.findById(tx, taken.user_id)
      if (!profile) {
        return MAX_BOT_TEXTS.linkInvalid
      }
      await maxRepository.saveLink(
        tx,
        {
          userId: taken.user_id,
          maxUserId: user.user_id,
          chatId,
          username: usernameOf(user),
          displayName: displayNameOf(user),
        },
        now.toISOString(),
      )
      return MAX_BOT_TEXTS.linked(profile.game_nickname)
    })
  } catch (error) {
    // Параллельная привязка того же MAX к другому аккаунту.
    if (isUniqueViolation(error, MAX_USER_CONSTRAINT)) {
      return MAX_BOT_TEXTS.linkTaken
    }
    throw error
  }
}

/**
 * Нажатие кнопки анонса (MAX-07, как TGM-18–TGM-23). Всегда отвечает на
 * нажатие; отказ — уведомление и снятие кнопок с нажатого сообщения.
 */
async function onCallback(
  deps: AppDeps,
  max: MaxDeps,
  update: Extract<MaxUpdate, { update_type: 'message_callback' }>,
) {
  const { callback, message } = update
  let notice: string = MAX_CALLBACK_TEXTS.failed
  try {
    const messageId = message?.body?.mid
    if (!messageId) {
      notice = MAX_CALLBACK_TEXTS.stale
      return
    }
    const action = parseCallbackData(callback.payload ?? '')
    const outcome = action
      ? await pressButton(deps, max, callback.user.user_id, messageId, action)
      : refuse(MAX_CALLBACK_TEXTS.stale)
    notice = outcome.notice
    if (outcome.refused) {
      await max.gateway.removeKeyboard(messageId)
    }
  } finally {
    await max.gateway.answerCallback(callback.callback_id, notice)
  }
}

/** Итог нажатия: текст уведомления; отказ снимает кнопки (Q-110). */
type PressOutcome = { notice: string; refused: boolean }

const refuse = (notice: string): PressOutcome => ({ notice, refused: true })

async function pressButton(
  deps: AppDeps,
  max: MaxDeps,
  maxUserId: number,
  messageId: string,
  action: CallbackAction,
): Promise<PressOutcome> {
  const link = await maxRepository.linkByMax(deps.db, maxUserId)
  if (!link) {
    return refuse(MAX_CALLBACK_TEXTS.notLinked)
  }
  const event = await eventRepository.find(deps.db, action.eventId)
  if (!event) {
    return refuse(MAX_CALLBACK_TEXTS.deleted)
  }
  // Кнопки принимаются только с активного сообщения своего события.
  const active = await maxRepository.activeMessage(
    deps.db,
    action.eventId,
    link.userId,
  )
  if (!active || active.messageId !== messageId) {
    return refuse(MAX_CALLBACK_TEXTS.stale)
  }
  let viewer: ProfiledActor
  try {
    viewer = requireRole(await loadActor(deps.db, link.userId), INTERNAL_ROLES)
  } catch {
    return refuse(MAX_CALLBACK_TEXTS.forbidden)
  }
  if (event.closed_at) {
    return refuse(MAX_CALLBACK_TEXTS.closed)
  }
  if (parseTimestamp(event.starts_at) <= deps.now()) {
    return refuse(MAX_CALLBACK_TEXTS.started)
  }

  if (action.kind === 'answer') {
    try {
      await saveAnswer(deps, viewer, action.eventId, action.answer)
    } catch (error) {
      return refuse(refusalText(error))
    }
    const { html, keyboard } = maxEventMessage(
      active,
      action.eventId,
      action.answer,
    )
    await editMaxMessage(deps, max, link.userId, messageId, html, keyboard)
    // Сообщение этого события в Telegram — фоново (MAX-08).
    await runInBackground(deps, () =>
      syncEventMessages(deps, link.userId, action.eventId, 'max'),
    )
    return {
      notice: `Ваш ответ: ${EVENT_ANSWER_LABELS[action.answer]}`,
      refused: false,
    }
  }
  // «Изменить решение»: ответ не меняется до нового выбора (Q-76).
  const answers = await eventRepository.answersOf(
    deps.db,
    [action.eventId],
    link.userId,
  )
  const { html, keyboard } = maxEventMessage(
    active,
    action.eventId,
    answers.get(action.eventId) ?? null,
    true,
  )
  await editMaxMessage(deps, max, link.userId, messageId, html, keyboard)
  return { notice: MAX_CALLBACK_TEXTS.chooseAgain, refused: false }
}

/** Отказ `saveAnswer` при гонке с закрытием, началом или удалением события. */
function refusalText(error: unknown) {
  if (!(error instanceof ApiError)) {
    throw error
  }
  if (error.code === 'not_found') {
    return MAX_CALLBACK_TEXTS.deleted
  }
  if (error.code === 'forbidden') {
    return MAX_CALLBACK_TEXTS.forbidden
  }
  if (error.code === 'state_conflict') {
    return error.fields?.reason === 'closed'
      ? MAX_CALLBACK_TEXTS.closed
      : MAX_CALLBACK_TEXTS.started
  }
  throw error
}
