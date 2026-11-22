/**
 * Bot API Telegram через `fetch` (без библиотеки бота — лёгкий старт функции).
 * Токен входит в адрес запроса, поэтому ни адрес, ни текст сетевой ошибки
 * (Deno включает в него URL) не логируются: только метод и код Telegram.
 */
export type InlineKeyboard = {
  inline_keyboard: { text: string; callback_data: string }[][]
}

/** `photoId` — `file_id` отправленной картинки для повторных отправок. */
export type SendResult =
  | { status: 'ok'; messageId: number; photoId?: string }
  | { status: 'blocked' }
  | { status: 'failed' }

/**
 * `not_modified` — текст и кнопки уже такие; `gone` — сообщение удалено
 * или его нельзя править; `blocked` — пользователь остановил бота.
 */
export type EditResult = 'ok' | 'not_modified' | 'gone' | 'blocked' | 'failed'

export type TelegramGateway = {
  /**
   * Сообщение в HTML (`parse_mode: HTML`), с кнопками или без; `photo` —
   * адрес или `file_id` картинки: текст становится подписью (TGM-27).
   */
  sendHtml(
    chatId: number,
    html: string,
    keyboard?: InlineKeyboard,
    photo?: string,
  ): Promise<SendResult>
  /** Картинка без подписи, для длинных анонсов (BRC-18). */
  sendPhoto(chatId: number, photo: string): Promise<SendResult>
  /** Простой текст без разметки: ответы бота (TGM-09). */
  sendText(chatId: number, text: string): Promise<SendResult>
  /**
   * Новый текст; `keyboard: null` убирает кнопки. `caption` — сообщение с
   * картинкой: меняется подпись, картинка остаётся (TGM-27).
   */
  editHtml(
    chatId: number,
    messageId: number,
    html: string,
    keyboard: InlineKeyboard | null,
    caption?: boolean,
  ): Promise<EditResult>
  /** Только кнопки; `null` убирает их. */
  editKeyboard(
    chatId: number,
    messageId: number,
    keyboard: InlineKeyboard | null,
  ): Promise<EditResult>
  /** Закрывает индикатор нажатия; текст — всплывающее пояснение. */
  answerCallback(callbackId: string, text?: string): Promise<void>
}

export type TelegramGatewayOptions = {
  token: string
  /** Подмена `https://api.telegram.org` фальшивым Bot API в тестах. */
  apiBase?: string | null
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  timeoutMs?: number
}

type ApiResponse = {
  ok: boolean
  result?: unknown
  error_code?: number
  description?: string
  parameters?: { retry_after?: number }
}

/** Пауза 429 не дольше 5 с: отправка 200 сообщений укладывается в запрос. */
const MAX_RETRY_AFTER_MS = 5_000
const EMPTY_KEYBOARD: InlineKeyboard = { inline_keyboard: [] }

export function createTelegramGateway(
  options: TelegramGatewayOptions,
): TelegramGateway {
  const base = `${options.apiBase || 'https://api.telegram.org'}/bot${options.token}`
  const doFetch = options.fetch ?? fetch
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const timeoutMs = options.timeoutMs ?? 10_000

  async function request(
    method: string,
    params: Record<string, unknown>,
  ): Promise<ApiResponse> {
    for (let attempt = 0; ; attempt++) {
      let body: ApiResponse
      try {
        const response = await doFetch(`${base}/${method}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
          signal: AbortSignal.timeout(timeoutMs),
        })
        body = (await response.json()) as ApiResponse
      } catch (error) {
        const name = error instanceof Error ? error.name : 'unknown'
        console.error(`Telegram ${method}: сбой запроса (${name})`)
        return { ok: false }
      }
      const retryAfter = body.parameters?.retry_after
      if (body.error_code === 429 && attempt === 0 && retryAfter) {
        await sleep(Math.min(retryAfter * 1000, MAX_RETRY_AFTER_MS))
        continue
      }
      if (!body.ok && body.error_code !== 403 && !isNotModified(body)) {
        console.error(
          `Telegram ${method}: ${body.error_code ?? '?'} ${body.description ?? ''}`,
        )
      }
      return body
    }
  }

  async function edit(method: string, params: Record<string, unknown>) {
    const body = await request(method, params)
    if (body.ok) {
      return 'ok'
    }
    if (isNotModified(body)) {
      return 'not_modified'
    }
    if (body.error_code === 403) {
      return 'blocked'
    }
    if (body.error_code === 400 && isGone(body)) {
      return 'gone'
    }
    return 'failed'
  }

  async function send(
    params: Record<string, unknown>,
    method = 'sendMessage',
  ): Promise<SendResult> {
    const body = await request(method, params)
    if (body.ok) {
      const result = body.result as
        { message_id?: unknown; photo?: { file_id?: unknown }[] } | undefined
      const messageId = result?.message_id
      if (typeof messageId === 'number') {
        // Самый крупный размер — последний.
        const photoId = result?.photo?.at(-1)?.file_id
        return typeof photoId === 'string'
          ? { status: 'ok', messageId, photoId }
          : { status: 'ok', messageId }
      }
      return { status: 'failed' }
    }
    return body.error_code === 403
      ? { status: 'blocked' }
      : { status: 'failed' }
  }

  return {
    sendPhoto(chatId, photo) {
      return send({ chat_id: chatId, photo }, 'sendPhoto')
    },
    sendHtml(chatId, html, keyboard, photo) {
      if (photo) {
        return send(
          {
            chat_id: chatId,
            photo,
            caption: html,
            parse_mode: 'HTML',
            ...(keyboard ? { reply_markup: keyboard } : {}),
          },
          'sendPhoto',
        )
      }
      return send({
        chat_id: chatId,
        text: html,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        ...(keyboard ? { reply_markup: keyboard } : {}),
      })
    },
    sendText(chatId, text) {
      return send({
        chat_id: chatId,
        text,
        link_preview_options: { is_disabled: true },
      })
    },
    editHtml(chatId, messageId, html, keyboard, caption = false) {
      if (caption) {
        return edit('editMessageCaption', {
          chat_id: chatId,
          message_id: messageId,
          caption: html,
          parse_mode: 'HTML',
          reply_markup: keyboard ?? EMPTY_KEYBOARD,
        })
      }
      return edit('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text: html,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        reply_markup: keyboard ?? EMPTY_KEYBOARD,
      })
    },
    editKeyboard(chatId, messageId, keyboard) {
      return edit('editMessageReplyMarkup', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: keyboard ?? EMPTY_KEYBOARD,
      })
    },
    async answerCallback(callbackId, text) {
      await request('answerCallbackQuery', {
        callback_query_id: callbackId,
        ...(text ? { text, show_alert: true } : {}),
      })
    },
  }
}

const isNotModified = (body: ApiResponse) =>
  body.error_code === 400 &&
  (body.description ?? '').includes('message is not modified')

const isGone = (body: ApiResponse) =>
  /message to edit not found|message can't be edited|message to delete not found/.test(
    body.description ?? '',
  )
