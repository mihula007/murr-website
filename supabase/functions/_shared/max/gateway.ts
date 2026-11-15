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
  /** Сообщение в HTML (`format: html`), с кнопками или без. */
  sendHtml(
    userId: number,
    html: string,
    keyboard?: MaxKeyboard,
  ): Promise<MaxSendResult>
  /** Простой текст: ответы бота (TGM-09). */
  sendText(userId: number, text: string): Promise<MaxSendResult>
  /** Новый текст; `keyboard: null` убирает кнопки. */
  editHtml(
    messageId: string,
    html: string,
    keyboard: MaxKeyboard | null,
  ): Promise<MaxEditResult>
  /** Только снять кнопки, текст не меняется. */
  removeKeyboard(messageId: string): Promise<MaxEditResult>
  /** Ответ на нажатие; текст — одноразовое уведомление. */
  answerCallback(callbackId: string, notification?: string): Promise<void>
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
    const result = await request(
      'POST',
      '/messages',
      { user_id: userId, disable_link_preview: 'true' },
      body,
    )
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
    sendHtml(userId, html, keyboard) {
      return send(userId, {
        text: html,
        format: 'html',
        ...(keyboard ? { attachments: [keyboardAttachment(keyboard)] } : {}),
      })
    },
    sendText(userId, text) {
      return send(userId, { text })
    },
    editHtml(messageId, html, keyboard) {
      return edit(messageId, {
        text: html,
        format: 'html',
        // Пустой список убирает вложения, в том числе кнопки.
        attachments: keyboard ? [keyboardAttachment(keyboard)] : [],
      })
    },
    removeKeyboard(messageId) {
      return edit(messageId, { attachments: [] })
    },
    async answerCallback(callbackId, notification) {
      await request(
        'POST',
        '/answers',
        { callback_id: callbackId },
        notification ? { notification } : {},
      )
    },
  }
}

function keyboardAttachment(keyboard: MaxKeyboard) {
  return { type: 'inline_keyboard', payload: { buttons: keyboard } }
}

/** Часть методов отвечает 200 с `success: false` вместо кода ошибки. */
function succeeded(result: ApiResult) {
  return result.httpStatus === 200 && result.body.success !== false
}
