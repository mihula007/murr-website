// Фальшивые Bot API для Playwright (этапы 13, 15): принимает вызовы функции
// `api` вместо api.telegram.org и platform-api.max.ru, отвечает как Telegram
// и MAX и отдаёт записанные вызовы тестам (`GET /calls?chat=<id>` — Telegram,
// `GET /max-calls?user=<id>` — MAX, `GET /vk-calls?peer=<id>` — ВКонтакте,
// методы ВКонтакте — по пути `/vk/<метод>`). Слушает все интерфейсы: функция в Docker
// обращается к нему через host.docker.internal (на Linux — через шлюз Docker).
// Запускается Playwright (`webServer`); данные только в памяти.
import { createServer } from 'node:http'
import { FAKE_TELEGRAM_PORT } from './telegram-config.ts'

type Call = {
  method: string
  params: Record<string, unknown>
  /** Номер отправленного сообщения (`sendMessage`). */
  messageId: number | null
}

const calls: Call[] = []
let nextMessageId = 1

/** Вызов MAX: метод с путём, параметры запроса и тело. */
type MaxCall = {
  method: string
  userId: number | null
  query: Record<string, string>
  body: Record<string, unknown>
  /** `mid` отправленного сообщения (`POST /messages`). */
  messageId: string | null
}

const maxCalls: MaxCall[] = []
/** `mid` → получатель: правки сообщения тоже относятся к пользователю. */
const maxOwners = new Map<string, number>()

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost')
  const reply = (status: number, body: unknown) => {
    response.writeHead(status, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify(body))
  }
  if (request.method === 'GET' && url.pathname === '/health') {
    reply(200, { ok: true })
    return
  }
  if (request.method === 'GET' && url.pathname === '/calls') {
    const chat = Number(url.searchParams.get('chat'))
    reply(
      200,
      calls.filter(
        (call) => call.params.chat_id === chat || !url.searchParams.has('chat'),
      ),
    )
    return
  }
  if (request.method === 'GET' && url.pathname === '/max-calls') {
    const user = Number(url.searchParams.get('user'))
    reply(
      200,
      maxCalls.filter((call) => call.userId === user),
    )
    return
  }
  if (request.method === 'GET' && url.pathname === '/vk-calls') {
    const peer = Number(url.searchParams.get('peer'))
    reply(
      200,
      vkCalls.filter((call) => call.peer === peer),
    )
    return
  }
  const vkMethod = /^\/vk\/([\w.]+)$/.exec(url.pathname)
  if (request.method === 'POST' && vkMethod) {
    handleVk(request, vkMethod[1]!, reply)
    return
  }
  if (url.pathname === '/messages' || url.pathname === '/answers') {
    handleMax(request, url, reply)
    return
  }
  const match = /^\/bot[^/]+\/(\w+)$/.exec(url.pathname)
  if (request.method !== 'POST' || !match) {
    reply(404, { ok: false, error_code: 404, description: 'Not Found' })
    return
  }
  let raw = ''
  request.on('data', (chunk: Buffer) => {
    raw += chunk.toString('utf8')
  })
  request.on('end', () => {
    const method = match[1]!
    const params = (raw ? JSON.parse(raw) : {}) as Record<string, unknown>
    const messageId = method === 'sendMessage' ? nextMessageId++ : null
    calls.push({ method, params, messageId })
    reply(200, {
      ok: true,
      result:
        messageId === null
          ? true
          : { message_id: messageId, chat: { id: params.chat_id } },
    })
  })
})

/** Вызов ВКонтакте: метод, получатель и параметры формы (без ключа). */
type VkCall = {
  method: string
  peer: number | null
  params: Record<string, string>
  /** `conversation_message_id` отправленного сообщения. */
  messageId: number | null
}

const vkCalls: VkCall[] = []

/** ВКонтакте: `messages.send`, `messages.edit`, ответы на нажатия и прочее. */
function handleVk(
  request: import('node:http').IncomingMessage,
  method: string,
  reply: (status: number, body: unknown) => void,
) {
  let raw = ''
  request.on('data', (chunk: Buffer) => {
    raw += chunk.toString('utf8')
  })
  request.on('end', () => {
    const params = Object.fromEntries(new URLSearchParams(raw))
    delete params.access_token
    const peer = Number(params.peer_ids ?? params.peer_id ?? params.user_ids)
    if (method === 'messages.send') {
      const messageId = nextMessageId++
      vkCalls.push({ method, peer, params, messageId })
      reply(200, {
        response: [
          { peer_id: peer, message_id: 0, conversation_message_id: messageId },
        ],
      })
      return
    }
    vkCalls.push({
      method,
      peer: Number.isNaN(peer) ? null : peer,
      params,
      messageId: null,
    })
    if (method === 'users.get') {
      reply(200, {
        response: [
          {
            id: peer,
            first_name: 'E2E',
            last_name: 'VK',
            screen_name: `vk${peer}`,
          },
        ],
      })
      return
    }
    if (method === 'groups.getCallbackConfirmationCode') {
      reply(200, { response: { code: 'e2e-confirm' } })
      return
    }
    reply(200, { response: 1 })
  })
}

/** MAX: `POST /messages`, `PUT /messages`, `POST /answers`. */
function handleMax(
  request: import('node:http').IncomingMessage,
  url: URL,
  reply: (status: number, body: unknown) => void,
) {
  let raw = ''
  request.on('data', (chunk: Buffer) => {
    raw += chunk.toString('utf8')
  })
  request.on('end', () => {
    const query = Object.fromEntries(url.searchParams)
    const body = (raw ? JSON.parse(raw) : {}) as Record<string, unknown>
    const method = `${request.method} ${url.pathname}`
    if (method === 'POST /messages') {
      const userId = Number(query.user_id)
      const mid = `mid.e2e.${nextMessageId++}`
      maxOwners.set(mid, userId)
      maxCalls.push({ method, userId, query, body, messageId: mid })
      reply(200, {
        message: {
          recipient: { chat_type: 'dialog', user_id: userId },
          body: { mid, seq: 1, text: body.text },
        },
      })
      return
    }
    const userId = query.message_id
      ? (maxOwners.get(query.message_id) ?? null)
      : null
    maxCalls.push({ method, userId, query, body, messageId: null })
    reply(200, { success: true })
  })
}

server.listen(FAKE_TELEGRAM_PORT, '0.0.0.0', () => {
  console.log(`Фальшивый Bot API: http://127.0.0.1:${FAKE_TELEGRAM_PORT}`)
})
