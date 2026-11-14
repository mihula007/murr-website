// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createVkGateway } from '../supabase/functions/_shared/vk/gateway.ts'

const TOKEN = 'fake-vk-token-for-tests'

type Reply = Record<string, unknown> | Error

/** Фальшивый API ВКонтакте: отвечает по очереди, записывает метод и форму. */
function fakeApi(...replies: Reply[]) {
  const calls: { url: string; form: URLSearchParams }[] = []
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    calls.push({
      url: String(url),
      form: new URLSearchParams(String(init?.body)),
    })
    const reply = replies.shift() ?? { response: 1 }
    if (reply instanceof Error) {
      throw reply
    }
    return new Response(JSON.stringify(reply))
  })
  const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {})
  const gateway = createVkGateway({
    token: TOKEN,
    groupId: 77,
    apiBase: 'http://fake.test',
    fetch,
    sleep,
    randomId: () => 42,
  })
  return { gateway, calls, sleep }
}

const vkError = (code: number) => ({ error: { error_code: code } })

afterEach(() => {
  vi.restoreAllMocks()
})

describe('vk gateway (VK-06, VK-07)', () => {
  it('sends plain text with an inline keyboard, token in the form body', async () => {
    const { gateway, calls } = fakeApi({
      response: [{ peer_id: 5, message_id: 0, conversation_message_id: 12 }],
    })
    const keyboard = [
      [
        {
          action: { type: 'callback' as const, label: 'Приду', payload: '{}' },
        },
      ],
    ]
    expect(await gateway.send(5, 'Рейд', keyboard)).toEqual({
      status: 'ok',
      messageId: 12,
    })
    const call = calls[0]!
    expect(call.url).toBe('http://fake.test/messages.send')
    expect(call.url).not.toContain(TOKEN)
    expect(call.form.get('access_token')).toBe(TOKEN)
    expect(call.form.get('v')).toBe('5.199')
    expect(call.form.get('peer_ids')).toBe('5')
    expect(call.form.get('random_id')).toBe('42')
    expect(call.form.get('message')).toBe('Рейд')
    expect(JSON.parse(call.form.get('keyboard')!)).toEqual({
      inline: true,
      buttons: keyboard,
    })
  })

  it('maps denied messages to blocked and other errors to failed', async () => {
    const { gateway } = fakeApi(
      vkError(901),
      { response: [{ peer_id: 5, error: { code: 902 } }] },
      vkError(100),
      new TypeError('network'),
    )
    expect(await gateway.send(5, 'x')).toEqual({ status: 'blocked' })
    expect(await gateway.send(5, 'x')).toEqual({ status: 'blocked' })
    expect(await gateway.send(5, 'x')).toEqual({ status: 'failed' })
    expect(await gateway.send(5, 'x')).toEqual({ status: 'failed' })
  })

  it('edits by conversation message id and removes the keyboard', async () => {
    const { gateway, calls } = fakeApi(
      { response: 1 },
      vkError(909),
      vkError(901),
    )
    expect(await gateway.edit(5, 12, 'Рейд', null)).toBe('ok')
    expect(calls[0]!.form.get('cmid')).toBe('12')
    expect(JSON.parse(calls[0]!.form.get('keyboard')!)).toEqual({
      inline: true,
      buttons: [],
    })
    expect(await gateway.edit(5, 12, 'Рейд', null)).toBe('gone')
    expect(await gateway.edit(5, 12, 'Рейд', null)).toBe('blocked')
  })

  it('answers a button press with a snackbar', async () => {
    const { gateway, calls } = fakeApi()
    await gateway.answerEvent(
      { eventId: 'ev1', userId: 5, peerId: 5 },
      'Событие удалено.',
    )
    expect(calls[0]!.url).toBe(
      'http://fake.test/messages.sendMessageEventAnswer',
    )
    expect(JSON.parse(calls[0]!.form.get('event_data')!)).toEqual({
      type: 'show_snackbar',
      text: 'Событие удалено.',
    })
  })

  it('reads the profile and the confirmation code', async () => {
    const { gateway } = fakeApi(
      {
        response: [{ first_name: 'Анна', last_name: 'К', screen_name: 'anna' }],
      },
      { response: { code: 'abc123' } },
    )
    expect(await gateway.profile(5)).toEqual({
      firstName: 'Анна',
      lastName: 'К',
      screenName: 'anna',
    })
    expect(await gateway.confirmationCode()).toBe('abc123')
  })

  it('retries once after flood control and never logs the token', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { gateway, sleep } = fakeApi(vkError(6), {
      response: [{ peer_id: 5, conversation_message_id: 3 }],
    })
    expect(await gateway.send(5, 'x')).toEqual({ status: 'ok', messageId: 3 })
    expect(sleep).toHaveBeenCalledOnce()
    const failing = fakeApi(new TypeError(`fetch ${TOKEN} failed`))
    await failing.gateway.send(5, 'x')
    for (const call of log.mock.calls) {
      expect(call.join(' ')).not.toContain(TOKEN)
    }
  })
})
