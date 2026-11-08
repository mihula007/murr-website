import { execFileSync } from 'node:child_process'

const NAMES = [
  'DB_URL',
  'API_URL',
  'ANON_KEY',
  'SERVICE_ROLE_KEY',
  'MAILPIT_URL',
]

/** Адреса и ключи локального стека берутся из `supabase status`, не из Git. */
export default function setup() {
  const output = execFileSync('npx', ['supabase', 'status', '-o', 'json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  const status = JSON.parse(output) as Record<string, string>
  for (const name of NAMES) {
    const value = status[name]
    if (!value) throw new Error(`Локальный Supabase не запущен: нет ${name}`)
    process.env[`LOCAL_${name}`] = value
  }
}
