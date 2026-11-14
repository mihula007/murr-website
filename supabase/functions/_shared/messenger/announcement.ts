import { EVENT_ANSWER_LABELS, type EventAnswer } from '../contracts/events.ts'

/**
 * Текст анонса в HTML — общий для Telegram и MAX (TGM-15, MAX-07): оба
 * понимают `<b>` и `<i>`, экранируются `<`, `>` и `&`.
 */
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

/** Текст анонса события со строкой «Ваш ответ» (TGM-19, MAX-07). */
export function eventHtml(
  announcement: AnnouncementText,
  answer: EventAnswer | null,
) {
  const base = announcementHtml(announcement)
  return answer
    ? `${base}\n\n<i>Ваш ответ: ${EVENT_ANSWER_LABELS[answer]}</i>`
    : base
}

/** Подпись кнопки «Изменить решение» (TGM-19, Q-76). */
export const CHANGE_LABEL = 'Изменить решение'

/** Простой текст анонса для ВКонтакте без разметки (VK-06). */
export function announcementPlain({ subject, body }: AnnouncementText) {
  return subject ? `${subject}\n\n${body}` : body
}

/** Простой текст анонса события со строкой ответа (VK-06, VK-07). */
export function eventPlain(
  announcement: AnnouncementText,
  answer: EventAnswer | null,
) {
  const base = announcementPlain(announcement)
  return answer ? `${base}\n\nВаш ответ: ${EVENT_ANSWER_LABELS[answer]}` : base
}
