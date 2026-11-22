import type { AppDeps, TelegramDeps } from '../app.ts'
import { withTransaction } from '../db/client.ts'
import { eventRepository } from '../events/repository.ts'
import { voteRepository } from '../votes/repository.ts'
import { announcementPlain } from '../messenger/announcement.ts'
import type { InlineKeyboard } from './gateway.ts'
import {
  announcementHtml,
  eventMessage,
  plainEventMessage,
  voteMessage,
  type AnnouncementText,
} from './render.ts'
import { telegramRepository, type ActiveVoteMessage } from './repository.ts'

/** Пул одновременных отправок и темп ≤ 25 сообщений в секунду (лимит ~30). */
const SEND_BATCH = 20
const BATCH_INTERVAL_MS = 800
/** Максимум Telegram для подписи к фотографии (в символах текста). */
const PHOTO_CAPTION_LIMIT = 1024

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
  /** Анонс группы — только её участникам (Q-104). */
  groupId: string | null = null,
  excludedUserIds: string[] = [],
  /** Картинка постоянного события (TGM-27); null — без картинки. */
  imageUrl: string | null = null,
  /** Активное голосование: серверные варианты добавляются в кнопки. */
  voteId: string | null = null,
  voteOptions?: readonly { id: string; label: string }[],
): Promise<DeliveryResult> {
  if (voteId && (!voteOptions || voteOptions.length === 0)) {
    throw new Error('Для рассылки голосования нужны его варианты')
  }
  const fetchedRecipients = await telegramRepository.recipients(
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
      telegramRepository.replaceVoteAnnouncement(tx, {
        voteId,
        ...announcement,
      }),
    )
    announcementId = replaced.announcementId
    await removeVoteButtons(deps, telegram, replaced.previousMessages)
  } else if (eventId) {
    announcementId = await telegramRepository.createAnnouncement(deps.db, {
      eventId,
      ...announcement,
    })
  }
  const existingChoices = voteId
    ? await voteRepository.choicesForVote(deps.db, voteId)
    : null
  let sent = 0
  let failed = 0
  // Адрес картинки, после первой успешной отправки — её `file_id`: Telegram
  // не скачивает картинку заново для каждого получателя.
  let photo = imageUrl

  const deliver = async (recipient: (typeof recipients)[number]) => {
    // Ответившие на событие анонс не получают (Q-109): кнопки без ответа.
    const voteMessageForUser =
      voteId && voteOptions
        ? voteMessage(
            announcement,
            voteOptions,
            existingChoices?.get(recipient.userId) ?? null,
          )
        : null
    const message = voteMessageForUser
      ? voteMessageForUser
      : eventId === null
        ? { html: announcementHtml(announcement), keyboard: undefined }
        : eventMessage(announcement, eventId, null)
    const sentPhoto = photo
    const longPhotoAnnouncement =
      sentPhoto !== null &&
      eventId === null &&
      announcementPlain(announcement).length > PHOTO_CAPTION_LIMIT
    let result = longPhotoAnnouncement
      ? await telegram.gateway.sendPhoto(recipient.chatId, sentPhoto)
      : await telegram.gateway.sendHtml(
          recipient.chatId,
          message.html,
          message.keyboard,
          sentPhoto ?? undefined,
        )
    let media: string | null = null
    if (sentPhoto && result.status === 'failed') {
      // Картинку отправить не удалось — тот же анонс без неё (TGM-27).
      result = await telegram.gateway.sendHtml(
        recipient.chatId,
        message.html,
        message.keyboard,
      )
    } else if (longPhotoAnnouncement && result.status === 'ok') {
      photo = result.photoId ?? sentPhoto
      // Подпись короче лимита; весь текст идёт следующим сообщением (BRC-18).
      result = await telegram.gateway.sendHtml(
        recipient.chatId,
        message.html,
        message.keyboard,
      )
    } else if (sentPhoto && result.status === 'ok') {
      media = result.photoId ?? sentPhoto
      if (result.photoId) {
        photo = result.photoId
      }
    }
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
    if (voteId && announcementId) {
      try {
        await withTransaction(deps.db, (tx) =>
          telegramRepository.saveActiveVoteMessage(tx, {
            voteId,
            userId: recipient.userId,
            announcementId,
            chatId: recipient.chatId,
            messageId: result.messageId,
            media,
          }),
        )
      } catch (error) {
        console.error('Сообщение голосования Telegram не сохранено', error)
        await telegram.gateway.editKeyboard(
          recipient.chatId,
          result.messageId,
          null,
        )
        failed++
      }
      return
    }
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
        media,
      }),
    )
    if (previous) {
      // Прежнее сообщение — только текст своего анонса (Q-78).
      await telegram.gateway.editHtml(
        previous.chatId,
        previous.messageId,
        plainEventMessage(previous),
        null,
        previous.media !== null,
      )
    }
  }

  // С картинкой первый получатель — отдельно, чтобы остальные получили
  // её по `file_id`.
  const first = photo && recipients.length > 0 ? 1 : 0
  if (first) {
    await deliver(recipients[0]!)
  }
  for (let start = first; start < recipients.length; start += SEND_BATCH) {
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

/** Ответ с сайта или из другого канала обновляет активное сообщение Telegram. */
export async function syncVoteMessage(
  deps: AppDeps,
  userId: string,
  voteId: string,
) {
  const telegram = deps.telegram
  if (!telegram) {
    return
  }
  const message = await telegramRepository.activeVoteMessage(
    deps.db,
    voteId,
    userId,
  )
  if (!message) {
    return
  }
  const vote = await voteRepository.find(deps.db, voteId)
  if (!vote || vote.closed_at !== null) {
    await editMessage(
      deps,
      telegram,
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
  const rendered = voteMessage(
    message,
    options.map((option) => ({ id: option.id, label: option.label })),
    choices.get(voteId) ?? null,
  )
  await editMessage(
    deps,
    telegram,
    userId,
    message,
    rendered.html,
    rendered.keyboard,
  )
}

async function removeVoteButtons(
  deps: AppDeps,
  telegram: TelegramDeps,
  messages: readonly ActiveVoteMessage[],
) {
  for (let start = 0; start < messages.length; start += SEND_BATCH) {
    const batch = messages.slice(start, start + SEND_BATCH)
    await Promise.all(
      batch.map(async (message) => {
        const result = await telegram.gateway.editKeyboard(
          message.chatId,
          message.messageId,
          null,
        )
        if (result === 'blocked') {
          await telegramRepository.markBlocked(
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

/** Перерисовка сообщения; остановленный бот отмечается (TGM-08). */
export async function editMessage(
  deps: AppDeps,
  telegram: TelegramDeps,
  userId: string,
  target: { chatId: number; messageId: number; media: string | null },
  html: string,
  keyboard: InlineKeyboard | null,
) {
  const result = await telegram.gateway.editHtml(
    target.chatId,
    target.messageId,
    html,
    keyboard,
    target.media !== null,
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
