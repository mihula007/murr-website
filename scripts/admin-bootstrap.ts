// Однократное назначение первого администратора (Q-32).
// Запуск: npm run admin:bootstrap -- --email … --nickname … --name … --class …
// Облачная БД: строка подключения в ADMIN_DATABASE_URL (секрет, только в .env).
// Без неё используется локальный Supabase из `supabase status`.
import { execFileSync } from 'node:child_process'
import { parseArgs } from 'node:util'
import { bootstrapFirstAdmin } from '../supabase/functions/_shared/account/service.ts'
import { createDb } from '../supabase/functions/_shared/db/client.ts'
import { ApiError } from '../supabase/functions/_shared/http/errors.ts'

const MESSAGES: Record<string, string> = {
  already_bootstrapped:
    'Администратор уже назначен; повторный запуск отклонён.',
  not_found:
    'Пользователь с таким email не найден. Сначала зарегистрируйтесь на сайте.',
  email_not_confirmed: 'Email не подтверждён. Введите код из письма на сайте.',
  validation_failed: 'Проверьте параметры',
}

function localDbUrl() {
  const output = execFileSync('npx', ['supabase', 'status', '-o', 'json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  return (JSON.parse(output) as { DB_URL: string }).DB_URL
}

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    nickname: { type: 'string' },
    name: { type: 'string' },
    class: { type: 'string' },
  },
})

if (!values.email || !values.nickname || !values.name || !values.class) {
  console.error(
    'Нужны параметры: --email, --nickname (до 9 символов), --name (до 12), --class (slug, например mage)',
  )
  process.exit(2)
}

const target = process.env.ADMIN_DATABASE_URL
  ? 'облачная БД'
  : 'локальный Supabase'
const db = createDb(process.env.ADMIN_DATABASE_URL || localDbUrl())
try {
  const result = await bootstrapFirstAdmin(db, {
    email: values.email,
    gameNickname: values.nickname,
    displayName: values.name,
    classSlug: values.class,
  })
  console.log(
    `Готово (${target}): администратор назначен, id ${result.userId}.`,
  )
} catch (error) {
  if (error instanceof ApiError) {
    const fields = error.fields ? ` ${JSON.stringify(error.fields)}` : ''
    console.error(`${MESSAGES[error.code] ?? error.code}${fields}`)
  } else {
    console.error(error instanceof Error ? error.message : error)
  }
  process.exitCode = 1
} finally {
  await db.destroy()
}
