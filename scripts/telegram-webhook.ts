// Однократная регистрация вебхука рабочего бота на облачную функцию (этап 12).
// Запуск: npm run telegram:webhook -- --functions https://<project>.supabase.co/functions/v1
//         npm run telegram:webhook -- --delete
// Токен и секрет — из .env (те же значения, что в Supabase Secrets); не печатаются.
import { parseArgs } from 'node:util'
import {
  botApi,
  describe,
  requireEnv,
  setWebhook,
  webhookUrl,
} from './telegram-bot-api.ts'

const { values } = parseArgs({
  options: {
    functions: { type: 'string' },
    delete: { type: 'boolean', default: false },
  },
})

const token = requireEnv('TELEGRAM_BOT_TOKEN')

if (values.delete) {
  const result = await botApi(token, 'deleteWebhook')
  console.log(`Вебхук снят: ${describe(result)}`)
  process.exit(result.ok ? 0 : 1)
}

if (!values.functions?.startsWith('https://')) {
  console.error(
    'Укажите --functions https://<project>.supabase.co/functions/v1',
  )
  process.exit(1)
}
const secret = requireEnv('TELEGRAM_WEBHOOK_SECRET')
const hook = webhookUrl(values.functions)
const result = await setWebhook(token, hook, secret, false)
console.log(result.ok ? `Вебхук: ${hook}` : `Ошибка: ${describe(result)}`)
process.exit(result.ok ? 0 : 1)
