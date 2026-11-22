import type { AppDeps, VkDeps } from '../app.ts'
import { withTransaction } from '../db/client.ts'
import { eventRepository } from '../events/repository.ts'
import { voteRepository } from '../votes/repository.ts'
import { lockActiveVote } from '../votes/locking.ts'
import { serializeMessageUpdate } from '../messenger/message-queue.ts'
import {
  announcementPlain,
  type AnnouncementText,
} from '../messenger/announcement.ts'
import type { VkKeyboard } from './gateway.ts'
import { vkEventMessage } from './render.ts'
import { vkVoteMessage } from './render.ts'
import { vkRepository, type VkActiveVoteMessage } from './repository.ts'

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
  /** Анонс группы — только её участникам (Q-104). */
  groupId: string | null = null,
  excludedUserIds: string[] = [],
  /** Картинка постоянного события (VK-10); null — без картинки. */
  imageUrl: string | null = null,
  /** Активное голосование и его серверные варианты. */
  voteId: string | null = null,
  voteOptions?: readonly { id: string; label: string }[],
): Promise<DeliveryResult> {
  if (voteId && (!voteOptions || voteOptions.length === 0)) {
    throw new Error('Для рассылки голосования нужны его варианты')
  }
  const fetchedRecipients = await vkRepository.recipients(
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
    const replaced = await withTransaction(deps.db, async (tx) => {
      await lockActiveVote(tx, voteId, 'update')
      return vkRepository.replaceVoteAnnouncement(tx, {
        voteId,
        ...announcement,
      })
    })
    announcementId = replaced.announcementId
    await removeVoteButtons(deps, vk, replaced.previousMessages)
  } else if (eventId) {
    announcementId = await vkRepository.createAnnouncement(deps.db, {
      eventId,
      ...announcement,
    })
  }
  const existingChoices = voteId
    ? await voteRepository.choicesForVote(deps.db, voteId)
    : null
  let sent = 0
  let failed = 0
  // Картинка загружается один раз; не загрузилась — анонс без неё (VK-10).
  const attachment =
    imageUrl && recipients.length > 0
      ? await vk.gateway.uploadPhoto(imageUrl)
      : null

  const deliver = async (recipient: (typeof recipients)[number]) => {
    // Ответившие на событие анонс не получают (Q-109): кнопки без ответа.
    const voteMessage =
      voteId && voteOptions
        ? vkVoteMessage(
            announcement,
            voteOptions,
            existingChoices?.get(recipient.userId) ?? null,
          )
        : null
    const initialChoice = existingChoices?.get(recipient.userId) ?? null
    const message = voteMessage
      ? voteMessage
      : eventId === null
        ? { text: announcementPlain(announcement), keyboard: undefined }
        : vkEventMessage(announcement, eventId, null)
    let result = await vk.gateway.send(
      recipient.chatId,
      message.text,
      message.keyboard,
      attachment ?? undefined,
    )
    let media = attachment
    if (attachment && result.status === 'failed') {
      result = await vk.gateway.send(
        recipient.chatId,
        message.text,
        message.keyboard,
      )
      media = null
    }
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
    if (voteId && announcementId) {
      try {
        await withTransaction(deps.db, (tx) =>
          vkRepository.saveActiveVoteMessage(tx, {
            voteId,
            userId: recipient.userId,
            announcementId: announcementId!,
            chatId: recipient.chatId,
            messageId: result.messageId,
            media,
          }),
        )
      } catch (error) {
        console.error('Сообщение голосования ВКонтакте не сохранено', error)
        await vk.gateway.edit(
          recipient.chatId,
          result.messageId,
          message.text,
          null,
          media,
        )
        failed++
        return
      }
      sent++
      try {
        const latestChoices = await voteRepository.choicesOf(
          deps.db,
          [voteId],
          recipient.userId,
        )
        if ((latestChoices.get(voteId) ?? null) !== initialChoice) {
          await syncVkVoteMessage(deps, recipient.userId, voteId)
        }
      } catch (error) {
        console.error('Сообщение голосования ВКонтакте не обновлено', error)
      }
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
        media,
      }),
    )
    if (previous) {
      // Прежнее сообщение — только текст своего анонса (Q-78).
      await vk.gateway.edit(
        previous.chatId,
        previous.messageId,
        announcementPlain(previous),
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

/** Ответ сайта или другого мессенджера обновляет активное сообщение VK. */
export function syncVkVoteMessage(
  deps: AppDeps,
  userId: string,
  voteId: string,
) {
  return serializeMessageUpdate(`vk:${voteId}:${userId}`, () =>
    syncLatestVkVoteMessage(deps, userId, voteId),
  )
}

async function syncLatestVkVoteMessage(
  deps: AppDeps,
  userId: string,
  voteId: string,
) {
  const vk = deps.vk
  if (!vk) {
    return
  }
  for (let attempt = 0; attempt < 8; attempt++) {
    const message = await vkRepository.activeVoteMessage(
      deps.db,
      voteId,
      userId,
    )
    const link = await vkRepository.linkByUser(deps.db, userId)
    if (!message) {
      return
    }
    if (!link || link.chatId !== message.chatId) {
      return
    }
    const vote = await voteRepository.find(deps.db, voteId)
    if (!vote || vote.closed_at !== null) {
      await editVkMessage(
        deps,
        vk,
        userId,
        message,
        announcementPlain(message),
        null,
      )
      return
    }
    const [options, choices] = await Promise.all([
      voteRepository.totals(deps.db, [voteId]),
      voteRepository.choicesOf(deps.db, [voteId], userId),
    ])
    const selected = choices.get(voteId) ?? null
    const rendered = vkVoteMessage(
      message,
      options.map((option) => ({ id: option.id, label: option.label })),
      selected,
    )
    await editVkMessage(
      deps,
      vk,
      userId,
      message,
      rendered.text,
      rendered.keyboard,
    )
    const [current, latestChoices, latestVote] = await Promise.all([
      vkRepository.activeVoteMessage(deps.db, voteId, userId),
      voteRepository.choicesOf(deps.db, [voteId], userId),
      voteRepository.find(deps.db, voteId),
    ])
    if (
      !current ||
      current.messageId !== message.messageId ||
      current.announcementId !== message.announcementId
    ) {
      await editVkMessage(
        deps,
        vk,
        userId,
        message,
        announcementPlain(message),
        null,
      )
      return
    }
    if (!latestVote || latestVote.closed_at !== null) {
      await editVkMessage(
        deps,
        vk,
        userId,
        message,
        announcementPlain(message),
        null,
      )
      return
    }
    if ((latestChoices.get(voteId) ?? null) === selected) {
      return
    }
  }
}

async function removeVoteButtons(
  deps: AppDeps,
  vk: VkDeps,
  messages: readonly VkActiveVoteMessage[],
) {
  for (const message of messages) {
    const result = await vk.gateway.edit(
      message.chatId,
      message.messageId,
      announcementPlain(message),
      null,
      message.media,
    )
    if (result === 'blocked') {
      await vkRepository.markBlocked(
        deps.db,
        message.userId,
        deps.now().toISOString(),
      )
    }
  }
}

/** Перерисовка сообщения; запрет сообщений отмечается (VK-03). */
export async function editVkMessage(
  deps: AppDeps,
  vk: VkDeps,
  userId: string,
  target: { chatId: number; messageId: number; media: string | null },
  text: string,
  keyboard: VkKeyboard | null,
) {
  const result = await vk.gateway.edit(
    target.chatId,
    target.messageId,
    text,
    keyboard,
    target.media,
  )
  if (result === 'blocked') {
    await vkRepository.markBlocked(deps.db, userId, deps.now().toISOString())
  }
  return result
}

export { syncVkVoteMessage as syncVoteMessage }
