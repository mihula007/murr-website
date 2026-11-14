import { createApp, type TelegramEnv } from '../_shared/app.ts'

function requireEnv(name: string) {
  const value = Deno.env.get(name)
  if (!value) {
    throw new Error(`Не задана переменная окружения ${name}`)
  }
  return value
}

/** Telegram включается, только когда заданы токен, имя бота и секрет вебхука. */
function telegramEnv(): TelegramEnv | null {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN')
  const botUsername = Deno.env.get('TELEGRAM_BOT_USERNAME')
  const webhookSecret = Deno.env.get('TELEGRAM_WEBHOOK_SECRET')
  if (!token || !botUsername || !webhookSecret) {
    return null
  }
  return {
    token,
    botUsername,
    webhookSecret,
    siteUrl: Deno.env.get('SITE_URL') || null,
    apiBase: Deno.env.get('TELEGRAM_API_BASE') || null,
  }
}

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void }

// Переменные предоставляет платформа Supabase; секреты не хранятся в коде.
const { handler } = createApp(
  {
    dbUrl: requireEnv('SUPABASE_DB_URL'),
    supabaseUrl: requireEnv('SUPABASE_URL'),
    apiKey: requireEnv('SUPABASE_ANON_KEY'),
    serviceKey: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    // Необязательный секрет расписания (Supabase Secrets); без него выпуск
    // постоянных событий доступен только кнопкой офицера.
    cronSecret: Deno.env.get('EVENTS_CRON_SECRET') ?? null,
    telegram: telegramEnv(),
  },
  {
    // Задача доделывается после ответа (локально нужен policy = per_worker).
    background: (task) => {
      EdgeRuntime.waitUntil(
        task().catch((error: unknown) => {
          console.error('Фоновая задача не выполнена', error)
        }),
      )
      return Promise.resolve()
    },
  },
)

Deno.serve(handler)
