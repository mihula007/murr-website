import { EVENT_ANSWERS, type EventAnswer } from '../contracts/events.ts'

/**
 * Данные кнопок анонса события (TGM-18, TGM-19): `a:<eventId>:<y|m|n>` —
 * ответ, `c:<eventId>` — «Изменить решение». Telegram ограничивает
 * `callback_data` 64 байтами; данные не доверенные — права и состояние
 * проверяет сервис при каждом нажатии.
 */
export type CallbackAction =
  | { kind: 'answer'; eventId: string; answer: EventAnswer }
  | { kind: 'change'; eventId: string }

const ANSWER_CODES: Record<EventAnswer, string> = {
  yes: 'y',
  maybe: 'm',
  no: 'n',
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const ANSWER_PATTERN = new RegExp(`^a:(${UUID}):([ymn])$`)
const CHANGE_PATTERN = new RegExp(`^c:(${UUID})$`)

export function answerData(eventId: string, answer: EventAnswer) {
  return `a:${eventId}:${ANSWER_CODES[answer]}`
}

export function changeData(eventId: string) {
  return `c:${eventId}`
}

export function parseCallbackData(data: string): CallbackAction | null {
  const answer = ANSWER_PATTERN.exec(data)
  if (answer) {
    const code = answer[2]
    const value = EVENT_ANSWERS.find((item) => ANSWER_CODES[item] === code)
    return value ? { kind: 'answer', eventId: answer[1]!, answer: value } : null
  }
  const change = CHANGE_PATTERN.exec(data)
  return change ? { kind: 'change', eventId: change[1]! } : null
}
