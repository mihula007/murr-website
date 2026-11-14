// Общие помощники скриптов процесса сопровождающего (AGENTS.md):
// session-prepare.ts, review-prepare.ts, release.ts.
// Значения `.env` передаются командам только через окружение и никогда не
// печатаются; в журналы попадают лишь имена переменных.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { parseEnv } from 'node:util'

export const PROJECT_REF = 'fbhndmsmusbqntdymnaz'
/** Игнорируемая папка состояния скриптов процесса (`.tools/` в .gitignore). */
export const STATE_DIR = '.tools/session'

/** Непустые значения из `.env` (файла может не быть). */
export function loadDotEnv(): Record<string, string> {
  if (!existsSync('.env')) {
    return {}
  }
  const parsed = parseEnv(readFileSync('.env', 'utf8'))
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (value) {
      result[key] = value
    }
  }
  return result
}

const dotEnv = loadDotEnv()

/** Окружение для дочерних команд: процесс + непустые значения `.env`. */
export const childEnv: NodeJS.ProcessEnv = { ...process.env, ...dotEnv }

export function hasEnv(name: string): boolean {
  return Boolean(childEnv[name])
}

export type RunResult = { ok: boolean; out: string }

/**
 * Запускает команду через оболочку (на Windows npx — это npx.cmd).
 * `inherit` — вывод сразу в консоль; иначе вывод собирается и возвращается.
 */
export function run(
  command: string,
  options: { inherit?: boolean; timeoutMs?: number } = {},
): RunResult {
  const result = spawnSync(command, {
    shell: true,
    env: childEnv,
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    timeout: options.timeoutMs,
    windowsHide: true,
  })
  const out = `${result.stdout ?? ''}${result.stderr ?? ''}`
  return { ok: result.status === 0, out }
}

export function tail(text: string, lines = 15): string {
  return text.trim().split(/\r?\n/).slice(-lines).join('\n')
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function ensureStateDir(): void {
  mkdirSync(STATE_DIR, { recursive: true })
}

export function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return fallback
  }
}

export function writeJson(path: string, value: unknown): void {
  ensureStateDir()
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function localStackRunning(): boolean {
  return run('npx supabase status -o json', { timeoutMs: 60_000 }).ok
}

/** Строки отчёта: `[ok]` — готово, `[!!]` — мешает работе, `[--]` — к сведению. */
export const report = {
  ok: (message: string) => console.log(`[ok] ${message}`),
  fail: (message: string) => console.log(`[!!] ${message}`),
  note: (message: string) => console.log(`[--] ${message}`),
  step: (message: string) => console.log(`\n== ${message}`),
}
