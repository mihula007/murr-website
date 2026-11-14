// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTelegramGateway } from '../supabase/functions/_shared/telegram/gateway.ts'

const TOKEN = 'fake-token-for-tests'

type Reply = Record<string, unknown> | Error

/** Фальшивый Bot API: отвечает по очереди, записывает метод и параметры. */
function fakeApi(...replies: Reply[]) {
  const calls: { method: string; params: Record<string, unknown> }[] = []
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    const method = String(url).split('/').pop() ?? ''
    calls.push({ method, params: JSON.parse(String(init?.body)) })
    const reply = replies.shift() ?? { ok: true, result: true }
    if (reply instanceof Error) {
      throw reply
    }
    return new Response(JSON.stringify(reply))
  })
  const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {})
  const gateway = createTelegramGateway({
    token: TOKEN,
    apiBase: 'http://fake.test',
    fetch,
    sleep,
  })
  return { gateway, calls, fetch, sleep }
}

const errorReply = (code: number, description: string, extra = {}) => ({
  ok: false,
  error_code: code,
  description,
  ...extra,
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('telegram gateway', () => {
  it('sends HTML with buttons to the configured API base', async () => {
    const { gateway, calls, fetch } = fakeApi({
      ok: true,
      result: { message_id: 42 },
    })
    const keyboard = {
      inline_keyboard: [[{ text: 'Приду', callback_data: 'x' }]],
    }
    expect(await gateway.sendHtml(7, '<b>Рейд</b>', keyboard)).toEqual({
      status: 'ok',
      messageId: 42,
    })
    expect(String(fetch.mock.calls[0]![0])).toBe(
      `http://fake.test/bot${TOKEN}/sendMessage`,
    )
    expect(calls[0]!.params).toMatchObject({
      chat_id: 7,
      text: '<b>Рейд</b>',
      parse_mode: 'HTML',
      reply_markup: keyboard,
    })
  })

  it('reports a blocked bot without logging it as an error', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { gateway } = fakeApi(
      errorReply(403, 'Forbidden: bot was blocked by the user'),
    )
    expect(await gateway.sendText(7, 'Привет')).toEqual({ status: 'blocked' })
    expect(log).not.toHaveBeenCalled()
  })

  it('waits retry_after once on 429, capped at 5 s', async () => {
    const { gateway, sleep, calls } = fakeApi(
      errorReply(429, 'Too Many Requests', { parameters: { retry_after: 30 } }),
      { ok: true, result: { message_id: 1 } },
    )
    expect(await gateway.sendText(7, 'x')).toEqual({
      status: 'ok',
      messageId: 1,
    })
    expect(sleep).toHaveBeenCalledWith(5000)
    expect(calls).toHaveLength(2)
  })

  it('gives up after a second 429', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const tooMany = errorReply(429, 'Too Many Requests', {
      parameters: { retry_after: 1 },
    })
    const { gateway, calls } = fakeApi(tooMany, tooMany)
    expect(await gateway.sendText(7, 'x')).toEqual({ status: 'failed' })
    expect(calls).toHaveLength(2)
  })

  it('classifies edit results', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { gateway, calls } = fakeApi(
      { ok: true, result: true },
      errorReply(
        400,
        'Bad Request: message is not modified: specified new message content and reply markup are exactly the same',
      ),
      errorReply(400, 'Bad Request: message to edit not found'),
      errorReply(403, 'Forbidden: bot was blocked by the user'),
      errorReply(500, 'Internal Server Error'),
    )
    expect(await gateway.editHtml(7, 1, 'a', null)).toBe('ok')
    expect(await gateway.editHtml(7, 1, 'a', null)).toBe('not_modified')
    expect(await gateway.editKeyboard(7, 1, null)).toBe('gone')
    expect(await gateway.editKeyboard(7, 1, null)).toBe('blocked')
    expect(await gateway.editKeyboard(7, 1, null)).toBe('failed')
    // Без кнопок — пустая клавиатура: Telegram убирает прежние кнопки.
    expect(calls[0]!.params.reply_markup).toEqual({ inline_keyboard: [] })
  })

  it('never logs the token, even when fetch fails with the URL in the message', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { gateway } = fakeApi(
      new TypeError(
        `error sending request for url (http://fake.test/bot${TOKEN}/sendMessage)`,
      ),
      errorReply(400, 'Bad Request: chat not found'),
    )
    expect(await gateway.sendText(7, 'x')).toEqual({ status: 'failed' })
    expect(await gateway.sendText(7, 'x')).toEqual({ status: 'failed' })
    const logged = log.mock.calls.flat().map(String).join('\n')
    expect(logged).not.toContain(TOKEN)
    expect(logged).toContain('sendMessage')
  })

  it('answers a callback with an alert only when there is text', async () => {
    const { gateway, calls } = fakeApi()
    await gateway.answerCallback('q1')
    await gateway.answerCallback('q2', 'Ответы закрыты')
    expect(calls[0]!.params).toEqual({ callback_query_id: 'q1' })
    expect(calls[1]!.params).toEqual({
      callback_query_id: 'q2',
      text: 'Ответы закрыты',
      show_alert: true,
    })
  })
})
