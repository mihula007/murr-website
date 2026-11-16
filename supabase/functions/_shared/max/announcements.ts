import type { AppDeps, MaxDeps } from '../app.ts'
import { withTransaction } from '../db/client.ts'
import { eventRepository } from '../events/repository.ts'
import {
  announcementHtml,
  type AnnouncementText,
} from '../messenger/announcement.ts'
import type { MaxKeyboard } from './gateway.ts'
import { maxEventMessage } from './render.ts'
import { maxRepository } from './repository.ts'

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
): Promise<DeliveryResult> {
  const fetchedRecipients = await maxRepository.recipients(
    deps.db,
    eventId,
    groupId,
  )
  const excluded = new Set(excludedUserIds)
  const recipients = fetchedRecipients.filter(
    (recipient) => !excluded.has(recipient.userId),
  )
  const announcementId = eventId
    ? await maxRepository.createAnnouncement(deps.db, {
        eventId,
        ...announcement,
      })
    : null
  let sent = 0
  let failed = 0

  const deliver = async (recipient: (typeof recipients)[number]) => {
    // Ответившие на событие анонс не получают (Q-109): кнопки без ответа.
    const message =
      eventId === null
        ? { html: announcementHtml(announcement), keyboard: undefined }
        : maxEventMessage(announcement, eventId, null)
    const result = await max.gateway.sendHtml(
      recipient.maxUserId,
      message.html,
      message.keyboard,
    )
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
      }),
    )
    if (previous) {
      // Прежнее сообщение — только текст своего анонса (Q-78).
      await max.gateway.editHtml(
        previous.messageId,
        announcementHtml(previous),
        null,
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
  await editMaxMessage(deps, max, userId, message.messageId, html, keyboard)
}

/** Перерисовка сообщения; остановленный бот отмечается (MAX-03). */
export async function editMaxMessage(
  deps: AppDeps,
  max: MaxDeps,
  userId: string,
  messageId: string,
  html: string,
  keyboard: MaxKeyboard | null,
) {
  const result = await max.gateway.editHtml(messageId, html, keyboard)
  if (result === 'blocked') {
    await maxRepository.markBlocked(deps.db, userId, deps.now().toISOString())
  }
  return result
}
