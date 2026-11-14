// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  answerData,
  changeData,
  parseCallbackData,
} from '../supabase/functions/_shared/telegram/callback-data.ts'
import {
  announcementHtml,
  escapeHtml,
  eventMessage,
  plainEventMessage,
} from '../supabase/functions/_shared/telegram/render.ts'
import { BROADCAST_LIMITS } from '@contracts/broadcasts'
import { CALLBACK_TEXTS } from '../supabase/functions/_shared/telegram/messages.ts'

const EVENT_ID = '0b0e6c2a-8f0d-4c55-9a7e-2f5b8c1d3e4f'

describe('telegram callback data (TGM-18, TGM-19)', () => {
  it('round-trips answers and the change button within 64 bytes', () => {
    for (const answer of ['yes', 'maybe', 'no'] as const) {
      const data = answerData(EVENT_ID, answer)
      expect(new TextEncoder().encode(data).length).toBeLessThanOrEqual(64)
      expect(parseCallbackData(data)).toEqual({
        kind: 'answer',
        eventId: EVENT_ID,
        answer,
      })
    }
    expect(parseCallbackData(changeData(EVENT_ID))).toEqual({
      kind: 'change',
      eventId: EVENT_ID,
    })
  })

  it('rejects foreign or malformed data', () => {
    for (const data of [
      '',
      `a:${EVENT_ID}:x`,
      `a:${EVENT_ID}`,
      `c:${EVENT_ID}:y`,
      'a:not-a-uuid:y',
      `x:${EVENT_ID}`,
      `c:${EVENT_ID.toUpperCase()}`,
    ]) {
      expect(parseCallbackData(data)).toBeNull()
    }
  })
})

describe('telegram rendering (TGM-15, TGM-19, Q-78, Q-90)', () => {
  it('escapes only <, > and &', () => {
    expect(escapeHtml('<b>"Рейд" & \'сбор\'</b>')).toBe(
      '&lt;b&gt;"Рейд" &amp; \'сбор\'&lt;/b&gt;',
    )
  })

  it('puts the subject in bold on the first line', () => {
    expect(announcementHtml({ subject: 'Рейд <1>', body: 'Сбор & вход' })).toBe(
      '<b>Рейд &lt;1&gt;</b>\n\nСбор &amp; вход',
    )
    expect(announcementHtml({ subject: null, body: 'Текст' })).toBe('Текст')
  })

  it('shows three answer buttons without an answer', () => {
    const { html, keyboard } = eventMessage(
      { subject: null, body: 'Рейд' },
      EVENT_ID,
      null,
    )
    expect(html).toBe('Рейд')
    expect(keyboard.inline_keyboard).toEqual([
      [
        { text: 'Приду', callback_data: answerData(EVENT_ID, 'yes') },
        { text: '50/50', callback_data: answerData(EVENT_ID, 'maybe') },
        { text: 'Не приду', callback_data: answerData(EVENT_ID, 'no') },
      ],
    ])
  })

  it('shows the answer and «Изменить решение» after answering', () => {
    const { html, keyboard } = eventMessage(
      { subject: null, body: 'Рейд' },
      EVENT_ID,
      'maybe',
    )
    expect(html).toBe('Рейд\n\n<i>Ваш ответ: 50/50</i>')
    expect(keyboard.inline_keyboard).toEqual([
      [{ text: 'Изменить решение', callback_data: changeData(EVENT_ID) }],
    ])
  })

  it('keeps the answer line while choosing again (Q-76)', () => {
    const { html, keyboard } = eventMessage(
      { subject: null, body: 'Рейд' },
      EVENT_ID,
      'yes',
      true,
    )
    expect(html).toContain('Ваш ответ: Приду')
    expect(keyboard.inline_keyboard[0]).toHaveLength(3)
  })

  it('drops the answer line for a replaced announcement (Q-78)', () => {
    expect(plainEventMessage({ subject: 'Рейд', body: 'Сбор' })).toBe(
      '<b>Рейд</b>\n\nСбор',
    )
  })

  it('fits the Telegram limit of 4096 characters after parsing (Q-91)', () => {
    // Длина считается после разбора разметки: сущности не увеличивают её.
    const visible =
      BROADCAST_LIMITS.subject +
      2 +
      BROADCAST_LIMITS.body +
      '\n\nВаш ответ: Не приду'.length
    expect(visible).toBeLessThanOrEqual(4096)
  })

  it('keeps callback alerts within 200 characters', () => {
    for (const text of Object.values(CALLBACK_TEXTS)) {
      expect(text.length).toBeLessThanOrEqual(200)
    }
  })
})
