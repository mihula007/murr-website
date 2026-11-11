import {
  execFileSync,
  execSync,
  spawn,
  type ChildProcess,
} from 'node:child_process'

const NAMES = [
  'DB_URL',
  'API_URL',
  'ANON_KEY',
  'SERVICE_ROLE_KEY',
  'MAILPIT_URL',
]

async function functionsReady(apiUrl: string, key: string) {
  try {
    const response = await fetch(`${apiUrl}/functions/v1/api/catalog/classes`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    })
    return response.ok
  } catch {
    return false
  }
}

/**
 * Адреса и ключи локального стека берутся из `supabase status`, не из Git.
 * Если функции ещё не обслуживаются, запускает `supabase functions serve`.
 */
export default async function setup() {
  // Через оболочку: на Windows npx — это npx.cmd.
  const output = execSync('npx supabase status -o json', {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  const status = JSON.parse(output) as Record<string, string>
  for (const name of NAMES) {
    const value = status[name]
    if (!value) {
      throw new Error(`Локальный Supabase не запущен: нет ${name}`)
    }
    process.env[`LOCAL_${name}`] = value
  }

  const apiUrl = status.API_URL as string
  const key = status.ANON_KEY as string
  let serve: ChildProcess | undefined
  if (!(await functionsReady(apiUrl, key))) {
    serve = spawn('npx supabase functions serve', {
      stdio: 'ignore',
      detached: true,
      shell: true,
    })
    const deadline = Date.now() + 90_000
    while (!(await functionsReady(apiUrl, key))) {
      if (Date.now() > deadline) {
        throw new Error('Edge Functions не запустились')
      }
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }
  return () => {
    if (!serve?.pid) {
      return
    }
    // Группу процессов на Windows останавливает только taskkill.
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/pid', String(serve.pid), '/T', '/F'], {
        stdio: 'ignore',
      })
    } else {
      process.kill(-serve.pid)
    }
  }
}
