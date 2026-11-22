import type { AppDeps, VkDeps } from '../app.ts'
import { profileRepository } from '../account/repository.ts'
import {
  loadActor,
  requireRole,
  type Actor,
  type ProfiledActor,
} from '../auth/actor.ts'
import { runInBackground } from '../background.ts'
import { EVENT_ANSWER_LABELS } from '../contracts/events.ts'
import { parseTimestamp } from '../contracts/moscow-time.ts'
import {
  VK_LINK_TTL_MINUTES,
  type VkLinkStart,
  type VkStatus,
} from '../contracts/vk.ts'
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
import { announcementPlain } from '../messenger/announcement.ts'
import { randomCode, sameSecret, sha256Hex } from '../messenger/link-code.ts'
import { syncEventMessages } from '../messenger/sync.ts'
import { syncVoteMessages } from '../messenger/sync.ts'
import { editVkMessage } from './announcements.ts'
import { VK_BOT_TEXTS, VK_CALLBACK_TEXTS } from './messages.ts'
import { vkEventMessage, vkVoteMessage } from './render.ts'
import { VK_USER_CONSTRAINT, vkRepository } from './repository.ts'
import { saveBallot } from '../votes/service.ts'
import { voteRepository } from '../votes/repository.ts'
import {
  envelopeSchema,
  eventSchema,
  payloadData,
  type VkEvent,
  type VkMessageEvent,
} from './updates.ts'

/** Привязывают ВКонтакте член, офицер и администратор (VK-01). */
export const VK_LINKERS = INTERNAL_ROLES

/** ВКонтакте настроен на сервере, иначе `vk_unavailable`. */
export function requireVk(deps: AppDeps): VkDeps {
  if (!deps.vk) {
    throw new ApiError('vk_unavailable')
  }
  return deps.vk
}

/** Ответ Callback API: простой текст, иначе ВКонтакте повторяет событие. */
const text = (body: string) =>
  new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })

/** Состояние привязки для кабинета (VK-01, VK-03). */
export async function vkStatus(deps: AppDeps, actor: Actor): Promise<VkStatus> {
  const user = requireRole(actor, VK_LINKERS)
  const configured = Boolean(deps.vk)
  const link = await vkRepository.linkByUser(deps.db, user.userId)
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

/** Одноразовая ссылка `vk.me/<сообщество>?ref=<код>` (VK-01): в БД — хеш. */
export async function startVkLink(
  deps: AppDeps,
  actor: Actor,
): Promise<VkLinkStart> {
  const user = requireRole(actor, VK_LINKERS)
  const vk = requireVk(deps)
  const code = randomCode()
  const expiresAt = new Date(
    deps.now().getTime() + VK_LINK_TTL_MINUTES * 60_000,
  ).toISOString()
  await vkRepository.saveCode(deps.db, {
    userId: user.userId,
    codeHash: await sha256Hex(code),
    expiresAt,
  })
  return { url: `https://vk.me/${vk.groupName}?ref=${code}`, expiresAt }
}

/** Отвязка из кабинета: связь и неиспользованный код удаляются. */
export async function unlinkVk(deps: AppDeps, actor: Actor): Promise<VkStatus> {
  const user = requireRole(actor, VK_LINKERS)
  await withTransaction(deps.db, async (tx) => {
    await vkRepository.deleteLink(tx, user.userId)
    await vkRepository.deleteCode(tx, user.userId)
  })
  return vkStatus(deps, user)
}

/**
 * Callback API сообщества. Чужая группа или неверный секрет — `not_found`.
 * После проверки ответ всегда `ok` (на `confirmation` — строка
 * подтверждения): иначе ВКонтакте повторяет событие; сбой только логируется.
 */
export async function handleVkWebhook(
  deps: AppDeps,
  body: unknown,
): Promise<Response> {
  const vk = deps.vk
  const envelope = envelopeSchema.safeParse(body)
  if (
    !vk ||
    !envelope.success ||
    envelope.data.group_id !== vk.groupId ||
    !sameSecret(envelope.data.secret ?? '', vk.callbackSecret)
  ) {
    throw new ApiError('not_found')
  }
  if (envelope.data.type === 'confirmation') {
    const code = await vk.gateway.confirmationCode()
    if (!code) {
      throw new ApiError('vk_unavailable')
    }
    return text(code)
  }
  const parsed = eventSchema.safeParse(body)
  if (parsed.success) {
    try {
      await onEvent(deps, vk, parsed.data)
    } catch (error) {
      console.error('Событие ВКонтакте не обработано', error)
    }
  }
  return text('ok')
}

async function onEvent(deps: AppDeps, vk: VkDeps, event: VkEvent) {
  switch (event.type) {
    case 'message_new': {
      const { from_id: userId, peer_id: peerId, ref } = event.object.message
      // Только личный диалог пользователя с сообществом.
      if (userId <= 0 || peerId !== userId) {
        return
      }
      return onMessage(deps, vk, userId, ref)
    }
    case 'message_event':
      return onPress(deps, vk, event)
    case 'message_allow':
      return vkRepository.unblockByVk(deps.db, event.object.user_id)
    case 'message_deny':
      return vkRepository.markBlockedByVk(
        deps.db,
        event.object.user_id,
        deps.now().toISOString(),
      )
    case 'confirmation':
      return
  }
}

/** Первое сообщение по ссылке с `ref` привязывает; иначе — пояснение. */
async function onMessage(
  deps: AppDeps,
  vk: VkDeps,
  userId: number,
  ref: string | undefined,
) {
  if (ref) {
    const reply = await linkByCode(deps, vk, userId, ref)
    await vk.gateway.send(userId, reply)
    return
  }
  const link = await vkRepository.linkByVk(deps.db, userId)
  if (!link) {
    await vk.gateway.send(userId, VK_BOT_TEXTS.helpGuest(vk.siteUrl))
    return
  }
  // Новое сообщение: сообщения разрешены, имя обновляется (VK-03).
  const person = await displayOf(vk, userId)
  await vkRepository.touchLink(deps.db, userId, {
    chatId: userId,
    username: person.username,
    displayName: person.displayName,
  })
  const profile = await profileRepository.findById(deps.db, link.userId)
  await vk.gateway.send(
    userId,
    profile
      ? VK_BOT_TEXTS.helpLinked(profile.game_nickname)
      : VK_BOT_TEXTS.helpGuest(vk.siteUrl),
  )
}

/** Имя для показа из `users.get`; без ответа — ID. */
async function displayOf(vk: VkDeps, userId: number) {
  const profile = await vk.gateway.profile(userId)
  const name = profile
    ? [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim()
    : ''
  const screen = profile?.screenName?.trim()
  return {
    displayName: (name || `id${userId}`).slice(0, 200),
    username: screen && screen.length <= 64 ? screen : null,
  }
}

/** Привязка по коду из `ref` (VK-01): ответ бота — результат. */
async function linkByCode(
  deps: AppDeps,
  vk: VkDeps,
  userId: number,
  code: string,
): Promise<string> {
  const codeHash = await sha256Hex(code)
  const person = await displayOf(vk, userId)
  const now = deps.now()
  try {
    return await withTransaction(deps.db, async (tx) => {
      const taken = await vkRepository.takeCode(tx, codeHash)
      if (!taken || parseTimestamp(taken.expires_at) <= now) {
        return VK_BOT_TEXTS.linkInvalid
      }
      const existing = await vkRepository.linkByVk(tx, userId)
      if (existing && existing.userId !== taken.user_id) {
        return VK_BOT_TEXTS.linkTaken
      }
      const profile = await profileRepository.findById(tx, taken.user_id)
      if (!profile) {
        return VK_BOT_TEXTS.linkInvalid
      }
      await vkRepository.saveLink(
        tx,
        {
          userId: taken.user_id,
          vkUserId: userId,
          chatId: userId,
          username: person.username,
          displayName: person.displayName,
        },
        now.toISOString(),
      )
      return VK_BOT_TEXTS.linked(profile.game_nickname)
    })
  } catch (error) {
    if (isUniqueViolation(error, VK_USER_CONSTRAINT)) {
      return VK_BOT_TEXTS.linkTaken
    }
    throw error
  }
}

/**
 * Нажатие callback-кнопки (VK-07, как TGM-18–TGM-23). Всегда отвечает на
 * событие; отказ — уведомление и снятие кнопок с нажатого сообщения.
 */
async function onPress(deps: AppDeps, vk: VkDeps, event: VkMessageEvent) {
  const press = event.object
  const answerTarget = {
    eventId: press.event_id,
    userId: press.user_id,
    peerId: press.peer_id,
  }
  let notice: string = VK_CALLBACK_TEXTS.failed
  try {
    const messageId = press.conversation_message_id
    const action = parseCallbackData(payloadData(press.payload))
    if (!messageId || !action) {
      notice = VK_CALLBACK_TEXTS.stale
    } else {
      const target = { chatId: press.peer_id, messageId }
      const outcome = await pressButton(deps, vk, press.user_id, target, action)
      notice = outcome.notice
      if (outcome.refused) {
        await vk.gateway.edit(
          target.chatId,
          target.messageId,
          outcome.text ?? '',
          null,
          outcome.media,
        )
      }
    }
  } finally {
    await vk.gateway.answerEvent(answerTarget, notice)
  }
}

/**
 * Уведомление показывается при каждом нажатии (Q-110); `media` — картинка
 * активного сообщения, остаётся при снятии кнопок (VK-10).
 */
type PressOutcome = {
  notice: string
  refused: boolean
  text?: string
  media?: string | null
}

async function pressButton(
  deps: AppDeps,
  vk: VkDeps,
  vkUserId: number,
  target: { chatId: number; messageId: number },
  action: CallbackAction,
): Promise<PressOutcome> {
  // Картинка активного сообщения: снятие кнопок её сохраняет (VK-10).
  let activeMedia: string | null = null
  const refuse = (notice: string, text?: string): PressOutcome => ({
    notice,
    refused: text !== undefined,
    ...(text !== undefined ? { text, media: activeMedia } : {}),
  })
  const link = await vkRepository.linkByVk(deps.db, vkUserId)
  if (!link) {
    return refuse(VK_CALLBACK_TEXTS.notLinked)
  }
  if (action.kind === 'vote-answer' || action.kind === 'vote-change') {
    return pressVoteButton(deps, vk, link.userId, target, action)
  }
  const event = await eventRepository.find(deps.db, action.eventId)
  if (!event) {
    return refuse(VK_CALLBACK_TEXTS.deleted)
  }
  const active = await vkRepository.activeMessage(
    deps.db,
    action.eventId,
    link.userId,
  )
  if (
    !active ||
    active.chatId !== target.chatId ||
    active.messageId !== target.messageId
  ) {
    return refuse(VK_CALLBACK_TEXTS.stale)
  }
  activeMedia = active.media
  // Снять кнопки во ВКонтакте можно только правкой с текстом: текст анонса.
  const plain = vkEventMessage(active, action.eventId, null).text
  let viewer: ProfiledActor
  try {
    viewer = requireRole(await loadActor(deps.db, link.userId), INTERNAL_ROLES)
  } catch {
    return refuse(VK_CALLBACK_TEXTS.forbidden, plain)
  }
  if (event.closed_at) {
    return refuse(VK_CALLBACK_TEXTS.closed, plain)
  }
  if (parseTimestamp(event.starts_at) <= deps.now()) {
    return refuse(VK_CALLBACK_TEXTS.started, plain)
  }

  if (action.kind === 'answer') {
    try {
      await saveAnswer(deps, viewer, action.eventId, action.answer)
    } catch (error) {
      return refuse(refusalText(error), plain)
    }
    const { text: body, keyboard } = vkEventMessage(
      active,
      action.eventId,
      action.answer,
    )
    await editVkMessage(deps, vk, link.userId, active, body, keyboard)
    await runInBackground(deps, () =>
      syncEventMessages(deps, link.userId, action.eventId, 'vk'),
    )
    // Уведомление с ответом — всегда, в том числе когда старое сообщение
    // не правится (VK-08, Q-110).
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
  const { text: body, keyboard } = vkEventMessage(
    active,
    action.eventId,
    answers.get(action.eventId) ?? null,
    true,
  )
  await editVkMessage(deps, vk, link.userId, active, body, keyboard)
  return { notice: VK_CALLBACK_TEXTS.chooseAgain, refused: false }
}

async function pressVoteButton(
  deps: AppDeps,
  vk: VkDeps,
  userId: string,
  target: { chatId: number; messageId: number },
  action: Extract<CallbackAction, { kind: 'vote-answer' | 'vote-change' }>,
): Promise<PressOutcome> {
  const active = await vkRepository.activeVoteMessageByTarget(
    deps.db,
    target.chatId,
    target.messageId,
  )
  if (!active || active.userId !== userId) {
    return { notice: VK_CALLBACK_TEXTS.voteStale, refused: false }
  }
  const refuse = (notice: string): PressOutcome => ({
    notice,
    refused: true,
    text: announcementPlain(active),
    media: active.media,
  })
  let viewer: ProfiledActor
  try {
    viewer = requireRole(await loadActor(deps.db, userId), INTERNAL_ROLES)
  } catch {
    return refuse(VK_CALLBACK_TEXTS.forbidden)
  }
  const vote = await voteRepository.find(deps.db, active.voteId)
  if (!vote) return refuse(VK_CALLBACK_TEXTS.voteDeleted)
  if (vote.closed_at !== null) return refuse(VK_CALLBACK_TEXTS.voteClosed)

  if (action.kind === 'vote-answer') {
    let details
    try {
      details = await saveBallot(deps, viewer, {
        voteId: active.voteId,
        optionId: action.optionId,
      })
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      if (error.code === 'not_found') return refuse(VK_CALLBACK_TEXTS.voteStale)
      if (error.code === 'forbidden') return refuse(VK_CALLBACK_TEXTS.forbidden)
      if (error.code === 'state_conflict')
        return refuse(VK_CALLBACK_TEXTS.voteClosed)
      return { notice: VK_CALLBACK_TEXTS.failed, refused: false }
    }
    const rendered = vkVoteMessage(active, details.options, details.myOptionId)
    await editVkMessage(
      deps,
      vk,
      userId,
      active,
      rendered.text,
      rendered.keyboard,
    )
    await runInBackground(deps, () =>
      syncVoteMessages(deps, userId, active.voteId, 'vk'),
    )
    return {
      notice: `Ваш голос: ${details.options.find((option) => option.id === details.myOptionId)?.label ?? ''}`,
      refused: false,
    }
  }
  const [options, choices] = await Promise.all([
    voteRepository.totals(deps.db, [active.voteId]),
    voteRepository.choicesOf(deps.db, [active.voteId], userId),
  ])
  const rendered = vkVoteMessage(
    active,
    options.map((option) => ({ id: option.id, label: option.label })),
    choices.get(active.voteId) ?? null,
    true,
  )
  await editVkMessage(
    deps,
    vk,
    userId,
    active,
    rendered.text,
    rendered.keyboard,
  )
  return { notice: VK_CALLBACK_TEXTS.chooseAgain, refused: false }
}

/** Отказ `saveAnswer` при гонке с закрытием, началом или удалением события. */
function refusalText(error: unknown) {
  if (!(error instanceof ApiError)) {
    throw error
  }
  if (error.code === 'not_found') {
    return VK_CALLBACK_TEXTS.deleted
  }
  if (error.code === 'forbidden') {
    return VK_CALLBACK_TEXTS.forbidden
  }
  if (error.code === 'state_conflict') {
    return error.fields?.reason === 'closed'
      ? VK_CALLBACK_TEXTS.closed
      : VK_CALLBACK_TEXTS.started
  }
  throw error
}
