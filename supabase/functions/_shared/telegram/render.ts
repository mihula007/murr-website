import {
  EVENT_ANSWER_LABELS,
  EVENT_ANSWERS,
  type EventAnswer,
} from '../contracts/events.ts'
import { answerData, changeData } from './callback-data.ts'
import type { InlineKeyboard } from './gateway.ts'

/** В HTML Telegram экранируются только `<`, `>` и `&`. */
export function escapeHtml(text: string) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

export type AnnouncementText = { subject: string | null; body: string }

/** Тема жирным первой строкой, затем текст (TGM-15, Q-90). */
export function announcementHtml({ subject, body }: AnnouncementText) {
  const text = escapeHtml(body)
  return subject ? `<b>${escapeHtml(subject)}</b>\n\n${text}` : text
}

/**
 * Сообщение анонса события для участника (TGM-18–TGM-20): без ответа — три
 * кнопки; с ответом — строка «Ваш ответ» и «Изменить решение».
 * `choosing` — участник нажал «Изменить решение»: ответ остаётся в тексте,
 * снова видны три кнопки (Q-76).
 */
export function eventMessage(
  announcement: AnnouncementText,
  eventId: string,
  answer: EventAnswer | null,
  choosing = false,
): { html: string; keyboard: InlineKeyboard } {
  const base = announcementHtml(announcement)
  const html = answer
    ? `${base}\n\n<i>Ваш ответ: ${EVENT_ANSWER_LABELS[answer]}</i>`
    : base
  const keyboard =
    answer && !choosing ? changeKeyboard(eventId) : answerKeyboard(eventId)
  return { html, keyboard }
}

/** Прежнее или закрытое сообщение — только текст анонса, без кнопок (Q-78). */
export function plainEventMessage(announcement: AnnouncementText) {
  return announcementHtml(announcement)
}

export function answerKeyboard(eventId: string): InlineKeyboard {
  return {
    inline_keyboard: [
      EVENT_ANSWERS.map((answer) => ({
        text: EVENT_ANSWER_LABELS[answer],
        callback_data: answerData(eventId, answer),
      })),
    ],
  }
}

export function changeKeyboard(eventId: string): InlineKeyboard {
  return {
    inline_keyboard: [
      [{ text: 'Изменить решение', callback_data: changeData(eventId) }],
    ],
  }
}
