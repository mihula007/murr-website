import { createApp } from '../_shared/app.ts'

function requireEnv(name: string) {
  const value = Deno.env.get(name)
  if (!value) {
    throw new Error(`Не задана переменная окружения ${name}`)
  }
  return value
}

// Переменные предоставляет платформа Supabase; секреты не хранятся в коде.
const { handler } = createApp({
  dbUrl: requireEnv('SUPABASE_DB_URL'),
  supabaseUrl: requireEnv('SUPABASE_URL'),
  apiKey: requireEnv('SUPABASE_ANON_KEY'),
  serviceKey: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  // Необязательный секрет расписания (Supabase Secrets); без него выпуск
  // постоянных событий доступен только кнопкой офицера.
  cronSecret: Deno.env.get('EVENTS_CRON_SECRET') ?? null,
})

Deno.serve(handler)
