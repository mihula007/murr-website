/**
 * MAX Bot API через `fetch` (без библиотеки — лёгкий старт функции).
 * Токен передаётся заголовком `Authorization`; ни заголовки, ни текст
 * сетевой ошибки не логируются — только метод и код MAX.
 */
export type MaxButton = { type: 'callback'; text: string; payload: string }

/** Ряды кнопок `inline_keyboard` (MAX-07). */
export type MaxKeyboard = MaxButton[][]

export type MaxSendResult =
  | { status: 'ok'; messageId: string }
  | { status: 'blocked' }
  | { status: 'failed' }

/** `blocked` — бот остановлен или нет доступа к чату (403). */
export type MaxEditResult = 'ok' | 'blocked' | 'failed'

export type MaxGateway = {
  /**
   * Загрузка картинки с адреса сайта (MAX-13): токен для отправки многими
   * сообщениями; null — не удалось.
   */
  uploadImage(url: string): Promise<string | null>
  /**
   * Сообщение в HTML (`format: html`), с кнопками или без; `image` — токен
   * загруженной картинки над текстом.
   */
  sendHtml(
    userId: number,
    html: string,
    keyboard?: MaxKeyboard,
    image?: string,
  ): Promise<MaxSendResult>
  /** Простой текст: ответы бота (TGM-09). */
  sendText(userId: number, text: string): Promise<MaxSendResult>
  /**
   * Новый текст; `keyboard: null` убирает кнопки. Вложения заменяются
   * целиком, поэтому картинка сообщения (`image`) передаётся снова.
   */
  editHtml(
    messageId: string,
    html: string,
    keyboard: MaxKeyboard | null,
    image?: string | null,
  ): Promise<MaxEditResult>
  /** Только снять кнопки, текст и картинка (`image`) остаются. */
  removeKeyboard(
    messageId: string,
    image?: string | null,
  ): Promise<MaxEditResult>
  /** Ответ на нажатие; текст — одноразовое уведомление. */
  answerCallback(callbackId: string, notification: string): Promise<void>
}

export type MaxGatewayOptions = {
  token: string
  /** Подмена `https://platform-api.max.ru` фальшивым API в тестах. */
  apiBase?: string | null
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  timeoutMs?: number
}

type ApiResult = {
  httpStatus: number
  body: {
    success?: boolean
    code?: string | null
    message?: unknown
  }
}

export const MAX_API_BASE = 'https://platform-api.max.ru'
/** 429 приходит без `retry_after`: одна пауза и один повтор. */
const RETRY_PAUSE_MS = 1_000
/** Картинка ещё обрабатывается (`attachment.not.ready`): паузы перед повтором. */
const NOT_READY_PAUSES_MS = [500, 1_000, 2_000]

export function createMaxGateway(options: MaxGatewayOptions): MaxGateway {
  const base = options.apiBase || MAX_API_BASE
  const doFetch = options.fetch ?? fetch
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const timeoutMs = options.timeoutMs ?? 10_000

  async function request(
    method: 'POST' | 'PUT',
    path: string,
    query: Record<string, string | number>,
    body: Record<string, unknown>,
  ): Promise<ApiResult> {
    const search = new URLSearchParams(
      Object.entries(query).map(([key, value]) => [key, String(value)]),
    )
    for (let attempt = 0; ; attempt++) {
      let result: ApiResult
      try {
        const response = await doFetch(`${base}${path}?${search}`, {
          method,
          headers: {
            Authorization: options.token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        })
        const text = await response.text()
        result = {
          httpStatus: response.status,
          body: text ? (JSON.parse(text) as ApiResult['body']) : {},
        }
      } catch (error) {
        const name = error instanceof Error ? error.name : 'unknown'
        console.error(`MAX ${method} ${path}: сбой запроса (${name})`)
        return { httpStatus: 0, body: {} }
      }
      if (result.httpStatus === 429 && attempt === 0) {
        await sleep(RETRY_PAUSE_MS)
        continue
      }
      if (!succeeded(result) && result.httpStatus !== 403) {
        console.error(
          `MAX ${method} ${path}: ${result.httpStatus} ${result.body.code ?? ''}`,
        )
      }
      return result
    }
  }

  async function send(
    userId: number,
    body: Record<string, unknown>,
  ): Promise<MaxSendResult> {
    let result = await request(
      'POST',
      '/messages',
      { user_id: userId, disable_link_preview: 'true' },
      body,
    )
    for (const pause of NOT_READY_PAUSES_MS) {
      if (result.body.code !== 'attachment.not.ready') {
        break
      }
      await sleep(pause)
      result = await request(
        'POST',
        '/messages',
        { user_id: userId, disable_link_preview: 'true' },
        body,
      )
    }
    if (result.httpStatus === 200) {
      const mid = (
        result.body.message as { body?: { mid?: unknown } } | undefined
      )?.body?.mid
      return typeof mid === 'string' && mid
        ? { status: 'ok', messageId: mid }
        : { status: 'failed' }
    }
    return result.httpStatus === 403
      ? { status: 'blocked' }
      : { status: 'failed' }
  }

  async function edit(
    messageId: string,
    body: Record<string, unknown>,
  ): Promise<MaxEditResult> {
    const result = await request(
      'PUT',
      '/messages',
      { message_id: messageId },
      body,
    )
    if (succeeded(result)) {
      return 'ok'
    }
    return result.httpStatus === 403 ? 'blocked' : 'failed'
  }

  return {
    async uploadImage(url) {
      try {
        const file = await doFetch(url, {
          signal: AbortSignal.timeout(timeoutMs),
        })
        if (!file.ok) {
          console.error(`MAX картинка: сайт ответил ${file.status}`)
          return null
        }
        const image = await file.blob()
        const slot = await request('POST', '/uploads', { type: 'image' }, {})
        const uploadUrl = (slot.body as { url?: unknown }).url
        if (slot.httpStatus !== 200 || typeof uploadUrl !== 'string') {
          return null
        }
        const form = new FormData()
        form.append('data', image, 'image.jpg')
        const response = await doFetch(uploadUrl, {
          method: 'POST',
          body: form,
          signal: AbortSignal.timeout(timeoutMs),
        })
        const uploaded = (await response.json()) as {
          token?: unknown
          photos?: Record<string, { token?: unknown }>
        }
        const token =
          uploaded.token ??
          Object.values(uploaded.photos ?? {}).find(
            (photo) => typeof photo.token === 'string',
          )?.token
        if (typeof token !== 'string' || !token) {
          console.error(`MAX картинка: нет токена (${response.status})`)
          return null
        }
        return token
      } catch (error) {
        const name = error instanceof Error ? error.name : 'unknown'
        console.error(`MAX картинка: сбой загрузки (${name})`)
        return null
      }
    },
    sendHtml(userId, html, keyboard, image) {
      const attachments = messageAttachments(keyboard ?? null, image ?? null)
      return send(userId, {
        text: html,
        format: 'html',
        ...(attachments.length > 0 ? { attachments } : {}),
      })
    },
    sendText(userId, text) {
      return send(userId, { text })
    },
    editHtml(messageId, html, keyboard, image) {
      return edit(messageId, {
        text: html,
        format: 'html',
        // Пустой список убирает вложения, в том числе кнопки.
        attachments: messageAttachments(keyboard, image ?? null),
      })
    },
    removeKeyboard(messageId, image) {
      return edit(messageId, {
        attachments: messageAttachments(null, image ?? null),
      })
    },
    async answerCallback(callbackId, notification) {
      await request(
        'POST',
        '/answers',
        { callback_id: callbackId },
        // MAX отклоняет ответ без `message` и `notification` (Q-110).
        { notification },
      )
    },
  }
}

/** Картинка (если есть) и кнопки (если есть) — вложения сообщения. */
function messageAttachments(
  keyboard: MaxKeyboard | null,
  image: string | null,
) {
  return [
    ...(image ? [{ type: 'image', payload: { token: image } }] : []),
    ...(keyboard
      ? [{ type: 'inline_keyboard', payload: { buttons: keyboard } }]
      : []),
  ]
}

/** Часть методов отвечает 200 с `success: false` вместо кода ошибки. */
function succeeded(result: ApiResult) {
  return result.httpStatus === 200 && result.body.success !== false
}
