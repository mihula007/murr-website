// Локальная разработка бота (Q-87, Q-95): быстрый туннель Cloudflare к
// локальным Edge Functions и вебхук тестового бота на него. По Ctrl+C
// вебхук снимается, туннель закрывается.
// Запуск: npm run telegram:dev (рядом должен работать npm run supabase:functions).
// Нужны TELEGRAM_BOT_TOKEN и TELEGRAM_WEBHOOK_SECRET тестового бота в .env.
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { install, Tunnel, use as selectBinary } from 'cloudflared'
import {
  botApi,
  describe,
  requireEnv,
  setWebhook,
  webhookUrl,
} from './telegram-bot-api.ts'

/** Закреплённый выпуск cloudflared (30.10.2026); пакет иначе ставит последний. */
const CLOUDFLARED_VERSION = '2026.10.7'
const LOCAL_API = 'http://127.0.0.1:54321'

const token = requireEnv('TELEGRAM_BOT_TOKEN')
const secret = requireEnv('TELEGRAM_WEBHOOK_SECRET')

async function ensureBinary() {
  const file = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared'
  const path = join(
    'node_modules',
    '.cache',
    'cloudflared',
    CLOUDFLARED_VERSION,
    file,
  )
  if (!existsSync(path)) {
    console.log(
      `Скачиваю cloudflared ${CLOUDFLARED_VERSION} с github.com/cloudflare/cloudflared…`,
    )
    mkdirSync(dirname(path), { recursive: true })
    await install(path, CLOUDFLARED_VERSION)
  }
  selectBinary(path)
}

async function functionsRunning() {
  try {
    const response = await fetch(
      `${LOCAL_API}/functions/v1/api/catalog/classes`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      },
    )
    return response.ok
  } catch {
    return false
  }
}

function openTunnel() {
  const tunnel = Tunnel.quick(LOCAL_API, { '--no-autoupdate': true })
  const url = new Promise<string>((resolve, reject) => {
    tunnel.once('url', resolve)
    tunnel.once('exit', (code) =>
      reject(new Error(`cloudflared завершился с кодом ${code}`)),
    )
  })
  const connected = new Promise<void>((resolve) =>
    tunnel.once('connected', () => resolve()),
  )
  return { tunnel, ready: Promise.all([url, connected]).then(([u]) => u) }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

if (!(await functionsRunning())) {
  console.warn(
    'Локальные функции не отвечают: запустите npm run supabase:functions в соседнем терминале.',
  )
}
await ensureBinary()
const { tunnel, ready } = openTunnel()
const publicUrl = await ready
const hook = webhookUrl(`${publicUrl}/functions/v1`)
console.log(`Туннель: ${publicUrl}`)

// Новый адрес trycloudflare.com разрешается не сразу: несколько попыток.
let result = await setWebhook(token, hook, secret, true)
for (let attempt = 1; !result.ok && attempt < 10; attempt++) {
  await sleep(3000)
  result = await setWebhook(token, hook, secret, true)
}
if (!result.ok) {
  console.error(`Вебхук не установлен: ${describe(result)}`)
  tunnel.stop()
  process.exit(1)
}
console.log(`Вебхук тестового бота: ${hook}`)
console.log('Ctrl+C — снять вебхук и закрыть туннель.')

let stopping = false
async function stop() {
  if (stopping) {
    return
  }
  stopping = true
  const removed = await botApi(token, 'deleteWebhook')
  console.log(`Вебхук снят: ${describe(removed)}`)
  tunnel.stop()
  process.exit(0)
}
process.on('SIGINT', () => void stop())
process.on('SIGTERM', () => void stop())
tunnel.on('exit', () => {
  if (!stopping) {
    console.error('cloudflared остановился; вебхук снимается.')
    void stop()
  }
})
