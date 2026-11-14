// Регистрация сервера Callback API сообщества ВКонтакте на облачную функцию
// (этап 16). Запуск:
//   npm run vk:webhook -- --functions https://<project>.supabase.co/functions/v1
//   npm run vk:webhook -- --list
//   npm run vk:webhook -- --delete <server_id>
// Ключ сообщества и секрет — из .env (те же значения, что в Supabase Secrets);
// не печатаются. Функция сама отвечает на подтверждение адреса.
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: {
    functions: { type: 'string' },
    list: { type: 'boolean', default: false },
    delete: { type: 'string' },
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

const token = requireEnv('VK_BOT_TOKEN')
const groupId = requireEnv('VK_GROUP_ID')
const base = process.env.VK_API_BASE || 'https://api.vk.com/method'

type VkReply = {
  response?: unknown
  error?: { error_code?: number; error_msg?: string }
}

/** Вызов API; ключ — в теле формы, в вывод попадает только код ошибки. */
async function vk(method: string, params: Record<string, string>) {
  const response = await fetch(`${base}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      ...params,
      group_id: groupId,
      access_token: token,
      v: '5.199',
    }),
  })
  const reply = (await response.json()) as VkReply
  if (reply.error) {
    console.error(
      `${method}: ошибка ${reply.error.error_code ?? '?'} ${reply.error.error_msg ?? ''}`,
    )
    process.exit(1)
  }
  return reply.response
}

if (values.list) {
  const servers = (await vk('groups.getCallbackServers', {})) as {
    items?: { id: number; url: string; status: string }[]
  }
  for (const item of servers.items ?? []) {
    console.log(`${item.id} ${item.status} ${item.url}`)
  }
  process.exit(0)
}

if (values.delete) {
  await vk('groups.deleteCallbackServer', { server_id: values.delete })
  console.log(`Сервер ${values.delete} удалён`)
  process.exit(0)
}

if (!values.functions?.startsWith('https://')) {
  console.error(
    'Укажите --functions https://<project>.supabase.co/functions/v1',
  )
  process.exit(1)
}
const url = `${values.functions.replace(/\/+$/, '')}/api/vk/webhook`
// Сервер подтверждается сразу при добавлении: функция уже должна быть
// выложена с VK_* в Supabase Secrets.
const added = (await vk('groups.addCallbackServer', {
  url,
  title: 'Murr api',
  secret_key: requireEnv('VK_CALLBACK_SECRET'),
})) as { server_id?: number }
if (!added.server_id) {
  console.error('ВКонтакте не вернул ID сервера')
  process.exit(1)
}
await vk('groups.setCallbackSettings', {
  server_id: String(added.server_id),
  api_version: '5.199',
  message_new: '1',
  message_event: '1',
  message_allow: '1',
  message_deny: '1',
})
console.log(`Сервер Callback API ${added.server_id}: ${url}`)
