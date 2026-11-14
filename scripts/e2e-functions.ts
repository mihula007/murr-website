// Edge Functions для Playwright (этапы 13, 15): тот же `supabase functions serve`,
// но с выдуманными ботами Telegram, MAX и ВКонтакте и фальшивым Bot API
// (`e2e/fake-telegram.ts`).
// Настоящий бот и `.env` не используются: сценарии ничего не отправляют
// в Telegram. Значения пишутся в игнорируемый файл, секрет вебхука —
// случайный при каждом запуске; тесты читают его оттуда же.
// Запуск: npm run e2e:functions (вместо supabase:functions перед test:e2e).
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import {
  E2E_FUNCTIONS_ENV,
  FAKE_TELEGRAM_PORT,
} from '../e2e/telegram-config.ts'

writeFileSync(
  E2E_FUNCTIONS_ENV,
  [
    '# Создано scripts/e2e-functions.ts: выдуманный бот для Playwright.',
    'TELEGRAM_BOT_TOKEN=e2e-fake-token',
    'TELEGRAM_BOT_USERNAME=murr_e2e_bot',
    `TELEGRAM_WEBHOOK_SECRET=${randomBytes(24).toString('base64url')}`,
    'SITE_URL=http://127.0.0.1:4173/',
    // Функция в Docker обращается к фальшивому Bot API на машине.
    `TELEGRAM_API_BASE=http://host.docker.internal:${FAKE_TELEGRAM_PORT}`,
    // MAX (этап 15) — тот же фальшивый сервер.
    'MAX_BOT_TOKEN=e2e-fake-max-token',
    'MAX_BOT_USERNAME=murr_e2e_max_bot',
    `MAX_WEBHOOK_SECRET=${randomBytes(24).toString('base64url')}`,
    `MAX_API_BASE=http://host.docker.internal:${FAKE_TELEGRAM_PORT}`,
    // ВКонтакте (этап 16) — тот же фальшивый сервер, путь `/vk`.
    'VK_BOT_TOKEN=e2e-fake-vk-token',
    'VK_GROUP_ID=1',
    'VK_GROUP_NAME=murr_e2e',
    `VK_CALLBACK_SECRET=${randomBytes(24).toString('base64url')}`,
    `VK_API_BASE=http://host.docker.internal:${FAKE_TELEGRAM_PORT}/vk`,
    '',
  ].join('\n'),
)
console.log(`Записан ${E2E_FUNCTIONS_ENV}`)

// Через оболочку: на Windows npx — это npx.cmd.
const serve = spawn(
  `npx supabase functions serve --env-file ${E2E_FUNCTIONS_ENV}`,
  { stdio: 'inherit', shell: true },
)
serve.on('exit', (code) => process.exit(code ?? 0))
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => serve.kill(signal))
}
