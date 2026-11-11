// Записывает публичные адрес и ключ локального Supabase в игнорируемый
// env-файл Vite (по умолчанию .env.development.local). Только публичные
// значения; ключи стека не попадают в Git.
// Использование: node scripts/supabase-env.ts [.env.e2e.local]
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const target = process.argv[2] ?? '.env.development.local'
if (!/^\.env\.[a-z0-9]+\.local$/.test(target)) {
  throw new Error('Ожидается файл вида .env.<режим>.local')
}

const status = JSON.parse(
  // Через оболочку: на Windows npx — это npx.cmd.
  execSync('npx supabase status -o json', {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }),
) as { API_URL?: string; PUBLISHABLE_KEY?: string }
if (!status.API_URL || !status.PUBLISHABLE_KEY) {
  throw new Error('Локальный Supabase не запущен: npm run supabase:start')
}

writeFileSync(
  target,
  [
    '# Создано scripts/supabase-env.ts для локального Supabase.',
    `VITE_SUPABASE_URL=${status.API_URL}`,
    `VITE_SUPABASE_PUBLISHABLE_KEY=${status.PUBLISHABLE_KEY}`,
    '',
  ].join('\n'),
)
console.log(`Записан ${target}`)
