// Фальшивый Bot API для Playwright (этап 13): принимает вызовы функции `api`
// вместо api.telegram.org, отвечает как Telegram и отдаёт записанные вызовы
// тестам (`GET /calls?chat=<id>`). Слушает все интерфейсы: функция в Docker
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

server.listen(FAKE_TELEGRAM_PORT, '0.0.0.0', () => {
  console.log(`Фальшивый Bot API: http://127.0.0.1:${FAKE_TELEGRAM_PORT}`)
})
