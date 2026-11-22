import {
  EVENT_ANSWER_LABELS,
  EVENT_ANSWERS,
  type EventAnswer,
} from '../contracts/events.ts'
import {
  CHANGE_LABEL,
  announcementHtml,
  eventHtml,
  type AnnouncementText,
} from '../messenger/announcement.ts'
import { answerData, changeData } from '../messenger/callback-data.ts'
import {
  renderVoteMessage,
  type VoteMessageOption,
} from '../messenger/vote-message.ts'
import type { MaxButton, MaxKeyboard } from './gateway.ts'

/**
 * Сообщение анонса события в MAX (MAX-07): как в Telegram — три кнопки
 * или строка ответа и «Изменить решение».
 */
export function maxEventMessage(
  announcement: AnnouncementText,
  eventId: string,
  answer: EventAnswer | null,
  choosing = false,
): { html: string; keyboard: MaxKeyboard } {
  const keyboard =
    answer && !choosing
      ? [[button(CHANGE_LABEL, changeData(eventId))]]
      : [
          EVENT_ANSWERS.map((item) =>
            button(EVENT_ANSWER_LABELS[item], answerData(eventId, item)),
          ),
        ]
  return { html: eventHtml(announcement, answer), keyboard }
}

/** Сообщение голосования: варианты сеткой по два, как в остальных каналах. */
export function maxVoteMessage(
  announcement: AnnouncementText,
  options: readonly VoteMessageOption[],
  selectedOptionId: string | null,
  choosing = false,
) {
  const message = renderVoteMessage(
    announcement,
    options,
    selectedOptionId,
    choosing,
    32,
  )
  const buttons: MaxButton[] = message.actions.map(({ label, data }) =>
    button(label, data),
  )
  const keyboard: MaxKeyboard = []
  for (let index = 0; index < buttons.length; index += 2) {
    keyboard.push(buttons.slice(index, index + 2))
  }
  return {
    html: announcementHtml({ subject: null, body: message.text }),
    keyboard,
  }
}

const button = (text: string, payload: string): MaxButton => ({
  type: 'callback',
  text,
  payload,
})
