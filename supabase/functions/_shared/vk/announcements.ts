import type { AppDeps, VkDeps } from '../app.ts'
import { withTransaction } from '../db/client.ts'
import { eventRepository } from '../events/repository.ts'
import {
  announcementPlain,
  type AnnouncementText,
} from '../messenger/announcement.ts'
import type { VkKeyboard } from './gateway.ts'
import { vkEventMessage } from './render.ts'
import { vkRepository } from './repository.ts'

/** Пул одновременных отправок и темп ≤ 15 сообщений в секунду (лимит 20). */
const SEND_BATCH = 15
const BATCH_INTERVAL_MS = 1_000

export type DeliveryResult = {
  recipients: number
  sent: number
  failed: number
}

/**
 * Рассылка анонса во ВКонтакте (VK-05–VK-07): как в Telegram, сетевые
 * вызовы — вне транзакций; на каждого получателя анонса события — короткая
 * транзакция замены активного сообщения и снятие кнопок с прежнего.
 */
export async function deliverVkAnnouncement(
  deps: AppDeps,
  vk: VkDeps,
  announcement: AnnouncementText,
  eventId: string | null,
  /** Анонс группы — только её участникам (Q-102). */
  groupId: string | null = null,
): Promise<DeliveryResult> {
  const recipients = await vkRepository.recipients(deps.db, eventId, groupId)
  const announcementId = eventId
    ? await vkRepository.createAnnouncement(deps.db, {
        eventId,
        ...announcement,
      })
    : null
  let sent = 0
  let failed = 0

  const deliver = async (recipient: (typeof recipients)[number]) => {
    const message =
      eventId === null
        ? { text: announcementPlain(announcement), keyboard: undefined }
        : vkEventMessage(announcement, eventId, recipient.answer)
    const result = await vk.gateway.send(
      recipient.chatId,
      message.text,
      message.keyboard,
    )
    if (result.status === 'blocked') {
      await vkRepository.markBlocked(
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
      vkRepository.replaceActiveMessage(tx, {
        eventId,
        userId: recipient.userId,
        announcementId,
        chatId: recipient.chatId,
        messageId: result.messageId,
      }),
    )
    if (previous) {
      // Прежнее сообщение — только текст своего анонса (Q-78).
      await vk.gateway.edit(
        previous.chatId,
        previous.messageId,
        announcementPlain(previous),
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

/** Ответ на событие → активное сообщение события во ВКонтакте (VK-07). */
export async function syncVkEventMessage(
  deps: AppDeps,
  userId: string,
  eventId: string,
) {
  const vk = deps.vk
  if (!vk) {
    return
  }
  const message = await vkRepository.activeMessage(deps.db, eventId, userId)
  if (!message) {
    return
  }
  const answers = await eventRepository.answersOf(deps.db, [eventId], userId)
  const { text, keyboard } = vkEventMessage(
    message,
    eventId,
    answers.get(eventId) ?? null,
  )
  await editVkMessage(deps, vk, userId, message, text, keyboard)
}

/** Перерисовка сообщения; запрет сообщений отмечается (VK-03). */
export async function editVkMessage(
  deps: AppDeps,
  vk: VkDeps,
  userId: string,
  target: { chatId: number; messageId: number },
  text: string,
  keyboard: VkKeyboard | null,
) {
  const result = await vk.gateway.edit(
    target.chatId,
    target.messageId,
    text,
    keyboard,
  )
  if (result === 'blocked') {
    await vkRepository.markBlocked(deps.db, userId, deps.now().toISOString())
  }
  return result
}
