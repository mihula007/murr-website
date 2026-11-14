import type { AppDeps, TelegramDeps } from '../app.ts'
import { withTransaction } from '../db/client.ts'
import { eventRepository } from '../events/repository.ts'
import type { InlineKeyboard } from './gateway.ts'
import {
  announcementHtml,
  eventMessage,
  plainEventMessage,
  type AnnouncementText,
} from './render.ts'
import { telegramRepository } from './repository.ts'

/** Пул одновременных отправок и темп ≤ 25 сообщений в секунду (лимит ~30). */
const SEND_BATCH = 20
const BATCH_INTERVAL_MS = 800

export type DeliveryResult = {
  recipients: number
  sent: number
  failed: number
}

/**
 * Рассылка анонса всем получателям (TGM-14–TGM-22). Сетевые вызовы — вне
 * транзакций; на каждого успешного получателя анонса события — короткая
 * транзакция замены активного сообщения и снятие кнопок с прежнего.
 */
export async function deliverAnnouncement(
  deps: AppDeps,
  telegram: TelegramDeps,
  announcement: AnnouncementText,
  eventId: string | null,
): Promise<DeliveryResult> {
  const recipients = await telegramRepository.recipients(deps.db, eventId)
  const announcementId = eventId
    ? await telegramRepository.createAnnouncement(deps.db, {
        eventId,
        ...announcement,
      })
    : null
  let sent = 0
  let failed = 0

  const deliver = async (recipient: (typeof recipients)[number]) => {
    const message =
      eventId === null
        ? { html: announcementHtml(announcement), keyboard: undefined }
        : eventMessage(announcement, eventId, recipient.answer)
    const result = await telegram.gateway.sendHtml(
      recipient.chatId,
      message.html,
      message.keyboard,
    )
    if (result.status === 'blocked') {
      await telegramRepository.markBlocked(
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
      telegramRepository.replaceActiveMessage(tx, {
        eventId,
        userId: recipient.userId,
        announcementId,
        chatId: recipient.chatId,
        messageId: result.messageId,
      }),
    )
    if (previous) {
      // Прежнее сообщение — только текст своего анонса (Q-78).
      await telegram.gateway.editHtml(
        previous.chatId,
        previous.messageId,
        plainEventMessage(previous),
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

/**
 * Ответ на сайте → активное сообщение события в Telegram (TGM-21, Q-77):
 * строка ответа и «Изменить решение».
 */
export async function syncEventMessage(
  deps: AppDeps,
  userId: string,
  eventId: string,
) {
  const telegram = deps.telegram
  if (!telegram) {
    return
  }
  const message = await telegramRepository.activeMessage(
    deps.db,
    eventId,
    userId,
  )
  if (!message) {
    return
  }
  const answers = await eventRepository.answersOf(deps.db, [eventId], userId)
  const { html, keyboard } = eventMessage(
    message,
    eventId,
    answers.get(eventId) ?? null,
  )
  await editMessage(deps, telegram, userId, message, html, keyboard)
}

/** Перерисовка сообщения; остановленный бот отмечается (TGM-08). */
export async function editMessage(
  deps: AppDeps,
  telegram: TelegramDeps,
  userId: string,
  target: { chatId: number; messageId: number },
  html: string,
  keyboard: InlineKeyboard | null,
) {
  const result = await telegram.gateway.editHtml(
    target.chatId,
    target.messageId,
    html,
    keyboard,
  )
  if (result === 'blocked') {
    await telegramRepository.markBlocked(
      deps.db,
      userId,
      deps.now().toISOString(),
    )
  }
  return result
}
