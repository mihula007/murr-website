import {
  EVENT_ANSWER_LABELS,
  EVENT_ANSWERS,
  type EventAnswer,
} from '../contracts/events.ts'
import {
  announcementHtml,
  CHANGE_LABEL,
  eventHtml,
  type AnnouncementText,
} from '../messenger/announcement.ts'
import { answerData, changeData } from '../messenger/callback-data.ts'
import type { InlineKeyboard } from './gateway.ts'

export {
  announcementHtml,
  escapeHtml,
  type AnnouncementText,
} from '../messenger/announcement.ts'

/**
 * Сообщение анонса события для участника (TGM-18, TGM-19): без ответа — три
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
  const keyboard =
    answer && !choosing ? changeKeyboard(eventId) : answerKeyboard(eventId)
  return { html: eventHtml(announcement, answer), keyboard }
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
      [{ text: CHANGE_LABEL, callback_data: changeData(eventId) }],
    ],
  }
}
