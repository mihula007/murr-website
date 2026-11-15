/**
 * API ВКонтакте для бота сообщества через `fetch` (без библиотеки — лёгкий
 * старт функции). Запросы — `POST` формы, ключ сообщества в теле, а не в
 * адресе; ни тело, ни текст сетевой ошибки не логируются — только метод и код.
 */
export type VkButton = {
  action: { type: 'callback'; label: string; payload: string }
}

/** Ряды callback-кнопок inline-клавиатуры (VK-07). */
export type VkKeyboard = VkButton[][]

export type VkSendResult =
  | { status: 'ok'; messageId: number }
  | { status: 'blocked' }
  | { status: 'failed' }

/** `gone` — сообщение слишком старое или его нельзя править (909, 920). */
export type VkEditResult = 'ok' | 'gone' | 'blocked' | 'failed'

export type VkProfile = {
  firstName: string
  lastName: string | null
  screenName: string | null
}

export type VkGateway = {
  /** Сообщение простым текстом, с кнопками или без. */
  send(
    peerId: number,
    text: string,
    keyboard?: VkKeyboard,
  ): Promise<VkSendResult>
  /** Новый текст; `keyboard: null` убирает кнопки. */
  edit(
    peerId: number,
    messageId: number,
    text: string,
    keyboard: VkKeyboard | null,
  ): Promise<VkEditResult>
  /** Ответ на нажатие; текст — всплывающее уведомление. */
  answerEvent(
    event: { eventId: string; userId: number; peerId: number },
    text: string,
  ): Promise<void>
  /** Имя и короткий адрес для показа в кабинете. */
  profile(userId: number): Promise<VkProfile | null>
  /** Строка подтверждения адреса Callback API. */
  confirmationCode(): Promise<string | null>
}

export type VkGatewayOptions = {
  token: string
  groupId: number
  /** Подмена `https://api.vk.com/method` фальшивым API в тестах. */
  apiBase?: string | null
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  timeoutMs?: number
  /** Случайный `random_id` (защита от повторной отправки). */
  randomId?: () => number
}

type ApiResult = {
  response?: unknown
  error?: { error_code?: number; error_msg?: string }
}

export const VK_API_BASE = 'https://api.vk.com/method'
export const VK_API_VERSION = '5.199'
/** 900–902: пользователь запретил сообщения сообщества (VK-03). */
const BLOCKED_CODES = new Set([900, 901, 902])
/** 6 и 9 — слишком много запросов: одна пауза и один повтор. */
const RETRY_CODES = new Set([6, 9])
const RETRY_PAUSE_MS = 1_000
const GONE_CODES = new Set([909, 920])
const EMPTY_KEYBOARD = JSON.stringify({ inline: true, buttons: [] })

export function createVkGateway(options: VkGatewayOptions): VkGateway {
  const base = options.apiBase || VK_API_BASE
  const doFetch = options.fetch ?? fetch
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const timeoutMs = options.timeoutMs ?? 10_000
  const randomId =
    options.randomId ??
    (() => crypto.getRandomValues(new Int32Array(1))[0]! & 0x7fffffff)

  async function call(
    method: string,
    params: Record<string, string | number>,
  ): Promise<ApiResult> {
    const form = new URLSearchParams({
      ...Object.fromEntries(
        Object.entries(params).map(([key, value]) => [key, String(value)]),
      ),
      access_token: options.token,
      v: VK_API_VERSION,
    })
    for (let attempt = 0; ; attempt++) {
      let result: ApiResult
      try {
        const response = await doFetch(`${base}/${method}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form,
          signal: AbortSignal.timeout(timeoutMs),
        })
        result = (await response.json()) as ApiResult
      } catch (error) {
        const name = error instanceof Error ? error.name : 'unknown'
        console.error(`VK ${method}: сбой запроса (${name})`)
        return { error: {} }
      }
      const code = result.error?.error_code
      if (code !== undefined && RETRY_CODES.has(code) && attempt === 0) {
        await sleep(RETRY_PAUSE_MS)
        continue
      }
      if (
        code !== undefined &&
        !BLOCKED_CODES.has(code) &&
        !GONE_CODES.has(code)
      ) {
        console.error(`VK ${method}: ${code}`)
      }
      return result
    }
  }

  return {
    async send(peerId, text, keyboard) {
      const result = await call('messages.send', {
        peer_ids: peerId,
        random_id: randomId(),
        message: text,
        dont_parse_links: 1,
        ...(keyboard ? { keyboard: keyboardJson(keyboard) } : {}),
      })
      const code = result.error?.error_code
      if (code !== undefined) {
        return BLOCKED_CODES.has(code)
          ? { status: 'blocked' }
          : { status: 'failed' }
      }
      // С `peer_ids` ответ — массив; ошибка получателя — в его элементе.
      const item = Array.isArray(result.response)
        ? (result.response[0] as
            | {
                conversation_message_id?: unknown
                error?: { code?: number }
              }
            | undefined)
        : undefined
      if (item?.error) {
        return BLOCKED_CODES.has(item.error.code ?? 0)
          ? { status: 'blocked' }
          : { status: 'failed' }
      }
      return typeof item?.conversation_message_id === 'number'
        ? { status: 'ok', messageId: item.conversation_message_id }
        : { status: 'failed' }
    },
    async edit(peerId, messageId, text, keyboard) {
      const result = await call('messages.edit', {
        peer_id: peerId,
        cmid: messageId,
        message: text,
        dont_parse_links: 1,
        keyboard: keyboard ? keyboardJson(keyboard) : EMPTY_KEYBOARD,
      })
      const code = result.error?.error_code
      if (code === undefined) {
        return 'ok'
      }
      if (BLOCKED_CODES.has(code)) {
        return 'blocked'
      }
      return GONE_CODES.has(code) ? 'gone' : 'failed'
    },
    async answerEvent(event, text) {
      // Ответ без `event_data` в части клиентов не снимает загрузку (Q-110).
      const result = await call('messages.sendMessageEventAnswer', {
        event_id: event.eventId,
        user_id: event.userId,
        peer_id: event.peerId,
        event_data: JSON.stringify({
          type: 'show_snackbar',
          text: text.slice(0, 90),
        }),
      })
      // `call` не логирует 900–902 и 909/920; здесь важен любой отказ.
      const code = result.error?.error_code
      if (
        code !== undefined &&
        (BLOCKED_CODES.has(code) || GONE_CODES.has(code))
      ) {
        console.error(`VK messages.sendMessageEventAnswer: ${code}`)
      }
    },
    async profile(userId) {
      const result = await call('users.get', {
        user_ids: userId,
        fields: 'screen_name',
      })
      const user = Array.isArray(result.response)
        ? (result.response[0] as
            | {
                first_name?: unknown
                last_name?: unknown
                screen_name?: unknown
              }
            | undefined)
        : undefined
      if (!user || typeof user.first_name !== 'string') {
        return null
      }
      return {
        firstName: user.first_name,
        lastName: typeof user.last_name === 'string' ? user.last_name : null,
        screenName:
          typeof user.screen_name === 'string' ? user.screen_name : null,
      }
    },
    async confirmationCode() {
      const result = await call('groups.getCallbackConfirmationCode', {
        group_id: options.groupId,
      })
      const code = (result.response as { code?: unknown } | undefined)?.code
      return typeof code === 'string' ? code : null
    },
  }
}

function keyboardJson(keyboard: VkKeyboard) {
  return JSON.stringify({ inline: true, buttons: keyboard })
}
