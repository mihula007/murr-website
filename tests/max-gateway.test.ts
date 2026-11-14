// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMaxGateway } from '../supabase/functions/_shared/max/gateway.ts'

const TOKEN = 'fake-max-token-for-tests'

type Reply = { status?: number; body?: unknown } | Error

/** Фальшивый MAX API: отвечает по очереди, записывает запросы. */
function fakeApi(...replies: Reply[]) {
  const calls: {
    method: string
    url: URL
    headers: Headers
    body: Record<string, unknown>
  }[] = []
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    calls.push({
      method: String(init?.method),
      url: new URL(String(url)),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)),
    })
    const reply = replies.shift() ?? { body: { success: true } }
    if (reply instanceof Error) {
      throw reply
    }
    return new Response(JSON.stringify(reply.body ?? {}), {
      status: reply.status ?? 200,
    })
  })
  const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {})
  const gateway = createMaxGateway({
    token: TOKEN,
    apiBase: 'http://fake.test',
    fetch,
    sleep,
  })
  return { gateway, calls, sleep }
}

const sent = (mid: string) => ({
  body: {
    message: { body: { mid, seq: 1 }, recipient: { chat_type: 'dialog' } },
  },
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('max gateway (MAX-07)', () => {
  it('sends HTML with buttons by user id and token header', async () => {
    const { gateway, calls } = fakeApi(sent('mid.42'))
    const keyboard = [
      [{ type: 'callback' as const, text: 'Приду', payload: 'x' }],
    ]
    expect(await gateway.sendHtml(7, '<b>Рейд</b>', keyboard)).toEqual({
      status: 'ok',
      messageId: 'mid.42',
    })
    const call = calls[0]!
    expect(call.method).toBe('POST')
    expect(call.url.pathname).toBe('/messages')
    expect(call.url.searchParams.get('user_id')).toBe('7')
    expect(call.url.search).not.toContain(TOKEN)
    expect(call.headers.get('authorization')).toBe(TOKEN)
    expect(call.body).toEqual({
      text: '<b>Рейд</b>',
      format: 'html',
      attachments: [
        { type: 'inline_keyboard', payload: { buttons: keyboard } },
      ],
    })
  })

  it('reports a stopped bot as blocked and other errors as failed', async () => {
    const { gateway } = fakeApi(
      { status: 403, body: { code: 'chat.denied', message: 'denied' } },
      { status: 400, body: { code: 'proto.payload' } },
      new TypeError('network'),
      { body: { message: {} } },
    )
    expect(await gateway.sendText(1, 'x')).toEqual({ status: 'blocked' })
    expect(await gateway.sendText(1, 'x')).toEqual({ status: 'failed' })
    expect(await gateway.sendText(1, 'x')).toEqual({ status: 'failed' })
    expect(await gateway.sendText(1, 'x')).toEqual({ status: 'failed' })
  })

  it('edits text and removes buttons with an empty attachment list', async () => {
    const { gateway, calls } = fakeApi(
      { body: { success: true } },
      { body: { success: false, code: 'not.found' } },
      { status: 403, body: { code: 'chat.denied' } },
    )
    expect(await gateway.editHtml('mid.1', '<i>a</i>', null)).toBe('ok')
    expect(calls[0]!.method).toBe('PUT')
    expect(calls[0]!.url.searchParams.get('message_id')).toBe('mid.1')
    expect(calls[0]!.body).toEqual({
      text: '<i>a</i>',
      format: 'html',
      attachments: [],
    })
    expect(await gateway.removeKeyboard('mid.1')).toBe('failed')
    expect(calls[1]!.body).toEqual({ attachments: [] })
    expect(await gateway.editHtml('mid.1', 'a', null)).toBe('blocked')
  })

  it('answers a callback with a one-time notification', async () => {
    const { gateway, calls } = fakeApi()
    await gateway.answerCallback('cb-1', 'Событие удалено.')
    await gateway.answerCallback('cb-2')
    expect(calls[0]!.url.pathname).toBe('/answers')
    expect(calls[0]!.url.searchParams.get('callback_id')).toBe('cb-1')
    expect(calls[0]!.body).toEqual({ notification: 'Событие удалено.' })
    expect(calls[1]!.body).toEqual({})
  })

  it('retries once after 429 and never logs the token', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { gateway, sleep } = fakeApi(
      { status: 429, body: { code: 'too.many.requests' } },
      sent('mid.2'),
    )
    expect(await gateway.sendText(1, 'x')).toEqual({
      status: 'ok',
      messageId: 'mid.2',
    })
    expect(sleep).toHaveBeenCalledOnce()

    const failing = fakeApi(new TypeError(`fetch ${TOKEN} failed`))
    await failing.gateway.sendText(1, 'x')
    for (const call of log.mock.calls) {
      expect(call.join(' ')).not.toContain(TOKEN)
    }
  })
})
