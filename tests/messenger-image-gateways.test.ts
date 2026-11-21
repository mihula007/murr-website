// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMaxGateway } from '../supabase/functions/_shared/max/gateway.ts'
import { createTelegramGateway } from '../supabase/functions/_shared/telegram/gateway.ts'
import { createVkGateway } from '../supabase/functions/_shared/vk/gateway.ts'

/** Картинки анонсов постоянных событий в шлюзах (TGM-27, MAX-13, VK-10). */
const IMAGE_URL = 'https://site.test/messenger/tv20.jpg'

type Call = { method: string; url: string; body: BodyInit | null | undefined }

/** Фальшивый `fetch`: ответ по адресу, запись запросов. */
function fakeFetch(route: (url: string, init?: RequestInit) => Response) {
  const calls: Call[] = []
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    calls.push({
      method: String(init?.method ?? 'GET'),
      url: String(url),
      body: init?.body,
    })
    return route(String(url), init)
  })
  return { fetch, calls }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status })
const image = () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })
const parsed = (call: Call | undefined) =>
  JSON.parse(String(call?.body)) as Record<string, unknown>

afterEach(() => {
  vi.restoreAllMocks()
})

describe('telegram gateway with a photo (TGM-27)', () => {
  it('sends a photo with an HTML caption and returns the largest file_id', async () => {
    const { fetch, calls } = fakeFetch(() =>
      json({
        ok: true,
        result: {
          message_id: 5,
          photo: [{ file_id: 'small' }, { file_id: 'large' }],
        },
      }),
    )
    const gateway = createTelegramGateway({
      token: 't',
      apiBase: 'http://tg.test',
      fetch,
    })
    const keyboard = {
      inline_keyboard: [[{ text: 'Приду', callback_data: 'a' }]],
    }
    expect(await gateway.sendHtml(1, '<b>ТВ</b>', keyboard, IMAGE_URL)).toEqual(
      {
        status: 'ok',
        messageId: 5,
        photoId: 'large',
      },
    )
    expect(calls[0]?.url).toBe('http://tg.test/bott/sendPhoto')
    expect(parsed(calls[0])).toEqual({
      chat_id: 1,
      photo: IMAGE_URL,
      caption: '<b>ТВ</b>',
      parse_mode: 'HTML',
      reply_markup: keyboard,
    })
  })

  it('edits the caption of a photo message', async () => {
    const { fetch, calls } = fakeFetch(() => json({ ok: true, result: true }))
    const gateway = createTelegramGateway({
      token: 't',
      apiBase: 'http://tg.test',
      fetch,
    })
    expect(await gateway.editHtml(1, 5, 'ТВ', null, true)).toBe('ok')
    expect(calls[0]?.url).toBe('http://tg.test/bott/editMessageCaption')
    expect(parsed(calls[0])).toMatchObject({
      chat_id: 1,
      message_id: 5,
      caption: 'ТВ',
      reply_markup: { inline_keyboard: [] },
    })
  })
})

describe('max gateway with an image (MAX-13)', () => {
  it('uploads the site image once and returns its token', async () => {
    const { fetch, calls } = fakeFetch((url) => {
      if (url === IMAGE_URL) {
        return image()
      }
      if (url.startsWith('http://max.test/uploads')) {
        return json({ url: 'http://upload.test/img' })
      }
      return json({ photos: { abc: { token: 'img-token' } } })
    })
    const gateway = createMaxGateway({
      token: 'm',
      apiBase: 'http://max.test',
      fetch,
    })
    expect(await gateway.uploadImage(IMAGE_URL)).toBe('img-token')
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `GET ${IMAGE_URL}`,
      'POST http://max.test/uploads?type=image',
      'POST http://upload.test/img',
    ])
    expect(calls[2]?.body).toBeInstanceOf(FormData)
    expect((calls[2]!.body as FormData).get('data')).toBeInstanceOf(Blob)
  })

  it('returns null when the site image is unavailable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { fetch } = fakeFetch(() => new Response('', { status: 404 }))
    const gateway = createMaxGateway({
      token: 'm',
      apiBase: 'http://max.test',
      fetch,
    })
    expect(await gateway.uploadImage(IMAGE_URL)).toBeNull()
  })

  it('puts the image before the keyboard and keeps it on edits', async () => {
    const { fetch, calls } = fakeFetch((_url, init) =>
      init?.method === 'POST'
        ? json({ message: { body: { mid: 'mid.1' } } })
        : json({ success: true }),
    )
    const gateway = createMaxGateway({
      token: 'm',
      apiBase: 'http://max.test',
      fetch,
    })
    const keyboard = [
      [{ type: 'callback' as const, text: 'Приду', payload: 'x' }],
    ]
    await gateway.sendHtml(7, 'ТВ', keyboard, 'img-token')
    await gateway.editHtml('mid.1', 'ТВ', null, 'img-token')
    await gateway.removeKeyboard('mid.1', 'img-token')
    const imageAttachment = { type: 'image', payload: { token: 'img-token' } }
    expect(parsed(calls[0]).attachments).toEqual([
      imageAttachment,
      { type: 'inline_keyboard', payload: { buttons: keyboard } },
    ])
    expect(parsed(calls[1]).attachments).toEqual([imageAttachment])
    expect(parsed(calls[2]).attachments).toEqual([imageAttachment])
  })

  it('waits and retries while the image is not ready', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let attempts = 0
    const { fetch } = fakeFetch(() =>
      attempts++ < 2
        ? json({ code: 'attachment.not.ready', message: 'x' }, 400)
        : json({ message: { body: { mid: 'mid.9' } } }),
    )
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {})
    const gateway = createMaxGateway({
      token: 'm',
      apiBase: 'http://max.test',
      fetch,
      sleep,
    })
    expect(await gateway.sendHtml(7, 'ТВ', undefined, 'img-token')).toEqual({
      status: 'ok',
      messageId: 'mid.9',
    })
    expect(sleep).toHaveBeenCalledTimes(2)
  })
})

describe('vk gateway with a photo (VK-10)', () => {
  it('uploads the photo to the community and builds the attachment', async () => {
    const { fetch, calls } = fakeFetch((url) => {
      if (url.endsWith('/photos.getMessagesUploadServer')) {
        return json({ response: { upload_url: 'http://upload.test/vk' } })
      }
      if (url === IMAGE_URL) {
        return image()
      }
      if (url === 'http://upload.test/vk') {
        return json({ server: 12, photo: '[{"photo":"x"}]', hash: 'h' })
      }
      return json({
        response: [{ owner_id: -777, id: 456, access_key: 'k1' }],
      })
    })
    const gateway = createVkGateway({
      token: 'v',
      groupId: 777,
      apiBase: 'http://vk.test',
      fetch,
    })
    expect(await gateway.uploadPhoto(IMAGE_URL)).toBe('photo-777_456_k1')
    expect((calls[2]!.body as FormData).get('photo')).toBeInstanceOf(Blob)
    const save = new URLSearchParams(String(calls[3]?.body))
    expect(calls[3]?.url).toBe('http://vk.test/photos.saveMessagesPhoto')
    expect(save.get('server')).toBe('12')
    expect(save.get('hash')).toBe('h')
  })

  it('returns null without photo access', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { fetch } = fakeFetch(() =>
      json({ error: { error_code: 15, error_msg: 'Access denied' } }),
    )
    const gateway = createVkGateway({
      token: 'v',
      groupId: 777,
      apiBase: 'http://vk.test',
      fetch,
    })
    expect(await gateway.uploadPhoto(IMAGE_URL)).toBeNull()
  })

  it('sends and edits with the attachment', async () => {
    const { fetch, calls } = fakeFetch(() =>
      json({ response: [{ conversation_message_id: 3 }] }),
    )
    const gateway = createVkGateway({
      token: 'v',
      groupId: 777,
      apiBase: 'http://vk.test',
      fetch,
    })
    await gateway.send(5, 'ТВ', undefined, 'photo-777_456_k1')
    await gateway.edit(5, 3, 'ТВ', null, 'photo-777_456_k1')
    for (const call of calls) {
      expect(new URLSearchParams(String(call.body)).get('attachment')).toBe(
        'photo-777_456_k1',
      )
    }
  })
})
