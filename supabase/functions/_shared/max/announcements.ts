import type { AppDeps, MaxDeps } from '../app.ts'
import { withTransaction } from '../db/client.ts'
import { eventRepository } from '../events/repository.ts'
import { voteRepository } from '../votes/repository.ts'
import {
  announcementHtml,
  type AnnouncementText,
} from '../messenger/announcement.ts'
import type { MaxKeyboard } from './gateway.ts'
import { maxEventMessage, maxVoteMessage } from './render.ts'
import { maxRepository, type MaxActiveVoteMessage } from './repository.ts'

/** Пул одновременных отправок и темп ≤ 25 сообщений в секунду. */
const SEND_BATCH = 20
const BATCH_INTERVAL_MS = 800

export type DeliveryResult = {
  recipients: number
  sent: number
  failed: number
}

/**
 * Рассылка анонса в MAX (MAX-06, MAX-07): как в Telegram, сетевые вызовы —
 * вне транзакций; на каждого получателя анонса события — короткая
 * транзакция замены активного сообщения и снятие кнопок с прежнего.
 */
export async function deliverMaxAnnouncement(
  deps: AppDeps,
  max: MaxDeps,
  announcement: AnnouncementText,
  eventId: string | null,
  /** Анонс группы — только её участникам (Q-104). */
  groupId: string | null = null,
  excludedUserIds: string[] = [],
  /** Картинка постоянного события (MAX-13); null — без картинки. */
  imageUrl: string | null = null,
  /** Активное голосование: серверные варианты добавляются в кнопки. */
  voteId: string | null = null,
  voteOptions?: readonly { id: string; label: string }[],
): Promise<DeliveryResult> {
  if (voteId && (!voteOptions || voteOptions.length === 0)) {
    throw new Error('Для рассылки голосования нужны его варианты')
  }
  const fetchedRecipients = await maxRepository.recipients(
    deps.db,
    eventId,
    groupId,
  )
  const excluded = new Set(excludedUserIds)
  const recipients = fetchedRecipients.filter(
    (recipient) => !excluded.has(recipient.userId),
  )
  let announcementId: string | null = null
  if (voteId) {
    const replaced = await withTransaction(deps.db, (tx) =>
      maxRepository.replaceVoteAnnouncement(tx, { voteId, ...announcement }),
    )
    announcementId = replaced.announcementId
    await removeVoteButtons(deps, max, replaced.previousMessages)
  } else if (eventId) {
    announcementId = await maxRepository.createAnnouncement(deps.db, {
      eventId,
      ...announcement,
    })
  }
  const existingChoices = voteId
    ? await voteRepository.choicesForVote(deps.db, voteId)
    : null
  let sent = 0
  let failed = 0
  // Картинка загружается один раз; не загрузилась — анонс без неё (MAX-13).
  const image =
    imageUrl && recipients.length > 0
      ? await max.gateway.uploadImage(imageUrl)
      : null

  const deliver = async (recipient: (typeof recipients)[number]) => {
    // Ответившие на событие анонс не получают (Q-109): кнопки без ответа.
    const voteMessageForUser =
      voteId && voteOptions
        ? maxVoteMessage(
            announcement,
            voteOptions,
            existingChoices?.get(recipient.userId) ?? null,
          )
        : null
    const message = voteMessageForUser
      ? voteMessageForUser
      : eventId === null
        ? { html: announcementHtml(announcement), keyboard: undefined }
        : maxEventMessage(announcement, eventId, null)
    let result = await max.gateway.sendHtml(
      recipient.maxUserId,
      message.html,
      message.keyboard,
      image ?? undefined,
    )
    let media = image
    if (image && result.status === 'failed') {
      result = await max.gateway.sendHtml(
        recipient.maxUserId,
        message.html,
        message.keyboard,
      )
      media = null
    }
    if (result.status === 'blocked') {
      await maxRepository.markBlocked(
        deps.db,
        recipient.userId,
        deps.now().toISOString(),
      )
      failed++
      return
    }
    if (result.status === 'failed') {
      failed++
      return
    }
    sent++
    if (voteId && announcementId) {
      try {
        await withTransaction(deps.db, (tx) =>
          maxRepository.saveActiveVoteMessage(tx, {
            voteId,
            userId: recipient.userId,
            announcementId,
            chatId: recipient.chatId,
            messageId: result.messageId,
            media,
          }),
        )
      } catch (error) {
        console.error('Сообщение голосования MAX не сохранено', error)
        await max.gateway.removeKeyboard(result.messageId, media)
        failed++
      }
      return
    }
    if (eventId === null || announcementId === null) {
      return
    }
    const previous = await withTransaction(deps.db, (tx) =>
      maxRepository.replaceActiveMessage(tx, {
        eventId,
        userId: recipient.userId,
        announcementId,
        chatId: recipient.chatId,
        messageId: result.messageId,
        media,
      }),
    )
    if (previous) {
      // Прежнее сообщение — только текст своего анонса (Q-78).
      await max.gateway.editHtml(
        previous.messageId,
        announcementHtml(previous),
        null,
        previous.media,
      )
    }
  }

  for (let start = 0; start < recipients.length; start += SEND_BATCH) {
    const begun = Date.now()
    await Promise.all(recipients.slice(start, start + SEND_BATCH).map(deliver))
    const rest = BATCH_INTERVAL_MS - (Date.now() - begun)
    if (start + SEND_BATCH < recipients.length && rest > 0) {
      await new Promise((resolve) => setTimeout(resolve, rest))
    }
  }
  return { recipients: recipients.length, sent, failed }
}

/** Ответ на событие → активное сообщение события в MAX (MAX-08). */
export async function syncMaxEventMessage(
  deps: AppDeps,
  userId: string,
  eventId: string,
) {
  const max = deps.max
  if (!max) {
    return
  }
  const message = await maxRepository.activeMessage(deps.db, eventId, userId)
  if (!message) {
    return
  }
  const answers = await eventRepository.answersOf(deps.db, [eventId], userId)
  const { html, keyboard } = maxEventMessage(
    message,
    eventId,
    answers.get(eventId) ?? null,
  )
  await editMaxMessage(deps, max, userId, message, html, keyboard)
}

/** Ответ с сайта или из другого канала обновляет активное сообщение MAX. */
export async function syncVoteMessage(
  deps: AppDeps,
  userId: string,
  voteId: string,
) {
  const max = deps.max
  if (!max) {
    return
  }
  const message = await maxRepository.activeVoteMessage(deps.db, voteId, userId)
  if (!message) {
    return
  }
  const vote = await voteRepository.find(deps.db, voteId)
  if (!vote || vote.closed_at !== null) {
    await editMaxMessage(
      deps,
      max,
      userId,
      message,
      announcementHtml(message),
      null,
    )
    return
  }
  const [options, choices] = await Promise.all([
    voteRepository.totals(deps.db, [voteId]),
    voteRepository.choicesOf(deps.db, [voteId], userId),
  ])
  const rendered = maxVoteMessage(
    message,
    options.map((option) => ({ id: option.id, label: option.label })),
    choices.get(voteId) ?? null,
  )
  await editMaxMessage(
    deps,
    max,
    userId,
    message,
    rendered.html,
    rendered.keyboard,
  )
}

async function removeVoteButtons(
  deps: AppDeps,
  max: MaxDeps,
  messages: readonly MaxActiveVoteMessage[],
) {
  for (let start = 0; start < messages.length; start += SEND_BATCH) {
    const batch = messages.slice(start, start + SEND_BATCH)
    await Promise.all(
      batch.map(async (message) => {
        const result = await max.gateway.removeKeyboard(
          message.messageId,
          message.media,
        )
        if (result === 'blocked') {
          await maxRepository.markBlocked(
            deps.db,
            message.userId,
            deps.now().toISOString(),
          )
        }
      }),
    )
    if (start + SEND_BATCH < messages.length) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_INTERVAL_MS))
    }
  }
}

/** Перерисовка сообщения; остановленный бот отмечается (MAX-03). */
export async function editMaxMessage(
  deps: AppDeps,
  max: MaxDeps,
  userId: string,
  target: { messageId: string; media: string | null },
  html: string,
  keyboard: MaxKeyboard | null,
) {
  const result = await max.gateway.editHtml(
    target.messageId,
    html,
    keyboard,
    target.media,
  )
  if (result === 'blocked') {
    await maxRepository.markBlocked(deps.db, userId, deps.now().toISOString())
  }
  return result
}
