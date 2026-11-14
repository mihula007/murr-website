// Регистрация вебхука бота MAX на облачную функцию (этап 14).
// Запуск: npm run max:webhook -- --functions https://<project>.supabase.co/functions/v1
//         npm run max:webhook -- --delete --functions https://<project>.supabase.co/functions/v1
//         npm run max:webhook -- --list
// Токен и секрет — из .env (те же значения, что в Supabase Secrets); не печатаются.
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: {
    functions: { type: 'string' },
    delete: { type: 'boolean', default: false },
    list: { type: 'boolean', default: false },
  },
})

function requireEnv(name: string) {
  const value = process.env[name]
  if (!value) {
    console.error(`Не задана переменная ${name} в .env`)
    process.exit(1)
  }
  return value
}

const token = requireEnv('MAX_BOT_TOKEN')
const base = process.env.MAX_API_BASE || 'https://platform-api2.max.ru'

/** Запрос к MAX API; в ответ попадают только код и описание, без токена. */
async function maxApi(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const json = (await response.json().catch(() => ({}))) as {
    success?: boolean
    code?: string
    message?: string
    subscriptions?: { url: string; update_types?: string[] }[]
  }
  const ok = response.ok && json.success !== false
  return { ok, status: response.status, json }
}

const describe = (result: Awaited<ReturnType<typeof maxApi>>) =>
  result.ok
    ? 'ok'
    : `${result.status} ${result.json.code ?? ''} ${result.json.message ?? ''}`

if (values.list) {
  const result = await maxApi('GET', '/subscriptions')
  for (const item of result.json.subscriptions ?? []) {
    console.log(`${item.url} ${(item.update_types ?? []).join(',')}`)
  }
  process.exit(result.ok ? 0 : 1)
}

if (!values.functions?.startsWith('https://')) {
  console.error(
    'Укажите --functions https://<project>.supabase.co/functions/v1',
  )
  process.exit(1)
}
const hook = `${values.functions.replace(/\/+$/, '')}/api/max/webhook`

if (values.delete) {
  const result = await maxApi(
    'DELETE',
    `/subscriptions?url=${encodeURIComponent(hook)}`,
  )
  console.log(`Вебхук снят: ${describe(result)}`)
  process.exit(result.ok ? 0 : 1)
}

const result = await maxApi('POST', '/subscriptions', {
  url: hook,
  update_types: [
    'bot_started',
    'bot_stopped',
    'message_created',
    'message_callback',
  ],
  secret: requireEnv('MAX_WEBHOOK_SECRET'),
})
console.log(result.ok ? `Вебхук: ${hook}` : `Ошибка: ${describe(result)}`)
process.exit(result.ok ? 0 : 1)
