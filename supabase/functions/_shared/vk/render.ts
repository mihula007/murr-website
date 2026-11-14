import {
  EVENT_ANSWER_LABELS,
  EVENT_ANSWERS,
  type EventAnswer,
} from '../contracts/events.ts'
import {
  CHANGE_LABEL,
  eventPlain,
  type AnnouncementText,
} from '../messenger/announcement.ts'
import { answerData, changeData } from '../messenger/callback-data.ts'
import type { VkButton, VkKeyboard } from './gateway.ts'

/**
 * Сообщение анонса события во ВКонтакте (VK-06, VK-07): простой текст,
 * три кнопки или строка ответа и «Изменить решение».
 */
export function vkEventMessage(
  announcement: AnnouncementText,
  eventId: string,
  answer: EventAnswer | null,
  choosing = false,
): { text: string; keyboard: VkKeyboard } {
  const keyboard =
    answer && !choosing
      ? [[button(CHANGE_LABEL, changeData(eventId))]]
      : [
          EVENT_ANSWERS.map((item) =>
            button(EVENT_ANSWER_LABELS[item], answerData(eventId, item)),
          ),
        ]
  return { text: eventPlain(announcement, answer), keyboard }
}

/** `payload` кнопки — JSON-объект с данными `{ d }`, не длиннее 255. */
const button = (label: string, data: string): VkButton => ({
  action: { type: 'callback', label, payload: JSON.stringify({ d: data }) },
})
