// Шаг 0 процесса сопровождающего (AGENTS.md) одной командой:
//   1. доступ к GitHub (gh, git push --dry-run) — с кешем на 7 дней;
//   2. ветка main без несохранённых изменений, догнана до origin/main;
//   3. Node.js 24;
//   4. зависимости: `npm clean-install`, только если изменился
//      package-lock.json или версия Node (отметка в node_modules);
//   5. Docker запущен (при необходимости запускается) и локальный Supabase
//      стартует в фоне — к шагу 4 он уже готов (review-prepare.ts дождётся);
//   6. `.env`: переменные выкладки на месте; доступ к Supabase CLI и привязка
//      проекта — с кешем на 7 дней.
// Значения секретов не печатаются. Кеш — .tools/session/state.json; ключ кеша
// включает хеш токена, поэтому новый токен проверяется заново.
// Запуск: npm run session:prepare [-- --force] [-- --no-stack]
//   --force    — проверить всё заново, без кеша;
//   --no-stack — не запускать локальный Supabase.
// Код выхода 1 — есть проблема, мешающая работе ([!!] в отчёте).
import { spawn } from 'node:child_process'
import { existsSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import {
  PROJECT_REF,
  STATE_DIR,
  childEnv,
  ensureStateDir,
  hasEnv,
  localStackRunning,
  readJson,
  report,
  run,
  sha256,
  sleep,
  tail,
  writeJson,
} from './local-env.ts'

const force = process.argv.includes('--force')
const startStack = !process.argv.includes('--no-stack')
const STATE_FILE = `${STATE_DIR}/state.json`
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const DEPLOY_VARIABLES = [
  'SUPABASE_DB_PASSWORD',
  'AUTH_SMTP_HOST',
  'AUTH_SMTP_USER',
  'AUTH_SMTP_PASS',
  'AUTH_SMTP_ADMIN_EMAIL',
  'AUTH_SMTP_SENDER_NAME',
]

let blocking = 0
function fail(message: string) {
  blocking += 1
  report.fail(message)
}

type State = { checks: Record<string, { key: string; at: number }> }
const state = readJson<State>(STATE_FILE, { checks: {} })

/** Проверка с кешем: повторяется, если прошло 7 дней или изменился ключ. */
function cachedCheck(name: string, key: string, check: () => boolean): boolean {
  const saved = state.checks[name]
  if (
    !force &&
    saved &&
    saved.key === key &&
    Date.now() - saved.at < CACHE_TTL_MS
  ) {
    return true
  }
  const ok = check()
  if (ok) {
    state.checks[name] = { key, at: Date.now() }
  } else {
    delete state.checks[name]
  }
  writeJson(STATE_FILE, state)
  return ok
}

// 1. Доступ к GitHub — до fetch, чтобы ошибка fetch говорила о ветке, а не о доступе.
report.step('Доступ к GitHub')
const githubOk = cachedCheck('github', sha256(childEnv.GH_TOKEN ?? ''), () => {
  if (hasEnv('GH_TOKEN')) {
    run('gh auth setup-git')
  }
  return run('gh auth status').ok && run('git push --dry-run origin main').ok
})
if (githubOk) {
  report.ok('gh и git push работают')
} else {
  fail(
    'Нет доступа к GitHub: нужен GH_TOKEN в .env (токен с правом push в репозиторий), затем повторить.',
  )
}

// 2. Ветка main.
report.step('Ветка main')
const dirty = run('git status --porcelain').out.trimEnd()
const branch = run('git branch --show-current').out.trim()
if (dirty) {
  fail(`Есть несохранённые изменения — ничего не трогаю:\n${dirty}`)
} else if (branch !== 'main' && !run('git switch main').ok) {
  fail(`Не удалось переключиться на main с ветки ${branch}.`)
} else {
  const fetch = run('git fetch origin')
  if (!fetch.ok) {
    fail(`git fetch origin не прошёл:\n${tail(fetch.out, 5)}`)
  } else {
    const [ahead = 0, behind = 0] = run(
      'git rev-list --left-right --count main...origin/main',
    )
      .out.trim()
      .split(/\s+/)
      .map(Number)
    if (ahead > 0 && behind > 0) {
      fail(
        `main разошлась с origin/main (своих коммитов ${ahead}, чужих ${behind}).`,
      )
    } else if (ahead > 0) {
      fail(`В main ${ahead} неотправленных коммитов — ничего не трогаю.`)
    } else if (behind > 0) {
      const pull = run('git pull --ff-only origin main')
      if (pull.ok) {
        report.ok(`main догнана до origin/main (+${behind} коммитов)`)
      } else {
        fail(`git pull --ff-only не прошёл:\n${tail(pull.out, 5)}`)
      }
    } else {
      report.ok('main совпадает с origin/main, изменений нет')
    }
  }
}

// 3. Node.js 24.
report.step('Node.js')
const nodeMajor = Number(process.versions.node.split('.')[0])
const expectedMajor = Number(readFileSync('.nvmrc', 'utf8').trim())
if (nodeMajor === expectedMajor) {
  report.ok(`Node ${process.versions.node}`)
} else {
  fail(`Node ${process.versions.node}, нужен ${expectedMajor} (.nvmrc).`)
}

// 4. Зависимости.
report.step('Зависимости')
const STAMP = 'node_modules/.session-stamp'
const stamp = sha256(
  `${readFileSync('package-lock.json', 'utf8')}\n${process.version}`,
)
if (!force && existsSync(STAMP) && readFileSync(STAMP, 'utf8') === stamp) {
  report.ok('Уже установлены по текущему package-lock.json')
} else {
  const install = run('npm clean-install --no-audit --no-fund')
  if (install.ok) {
    writeFileSync(STAMP, stamp)
    report.ok('Установлены (npm clean-install)')
  } else {
    fail(
      `npm clean-install не прошёл (если package-lock.json не совпадает с package.json — это ошибка репозитория, не чинить npm install):\n${tail(install.out)}`,
    )
  }
}

// 5. Docker и локальный Supabase.
report.step('Docker и локальный Supabase')
async function ensureDocker(): Promise<boolean> {
  if (run('docker info').ok) {
    return true
  }
  if (process.platform === 'win32') {
    // Установка для всех пользователей или только для текущего.
    const exe = [
      `${process.env.ProgramFiles ?? 'C:\\Program Files'}\\Docker\\Docker\\Docker Desktop.exe`,
      `${process.env.LOCALAPPDATA ?? ''}\\Programs\\DockerDesktop\\Docker Desktop.exe`,
    ].find((path) => existsSync(path))
    if (!exe) {
      return false
    }
    spawn(`"${exe}"`, { shell: true, detached: true, stdio: 'ignore' }).unref()
  } else if (process.platform === 'darwin') {
    run('open -a Docker')
  } else {
    return false
  }
  report.note('Docker Desktop запускается, жду до 3 минут…')
  for (let waited = 0; waited < 180_000; waited += 5_000) {
    await sleep(5_000)
    if (run('docker info').ok) {
      return true
    }
  }
  return false
}

const START_PID = `${STATE_DIR}/supabase-start.pid`
const START_LOG = `${STATE_DIR}/supabase-start.log`
if (!(await ensureDocker())) {
  fail(
    'Docker не запустился: попросить сопровождающего открыть программу Docker Desktop.',
  )
} else {
  report.ok('Docker работает')
  if (!startStack) {
    report.note('Локальный Supabase не запускаю (--no-stack)')
  } else if (localStackRunning()) {
    report.ok('Локальный Supabase уже запущен')
  } else {
    ensureStateDir()
    const log = openSync(START_LOG, 'w')
    const child = spawn('npx supabase start -x studio', {
      shell: true,
      detached: true,
      stdio: ['ignore', log, log],
      windowsHide: true,
    })
    child.unref()
    writeFileSync(START_PID, String(child.pid))
    report.ok(
      `Локальный Supabase запускается в фоне (журнал ${START_LOG}); npm run review:prepare дождётся его`,
    )
  }
}

// 6. .env и доступ к Supabase.
report.step('.env и доступ к Supabase')
if (!existsSync('.env')) {
  report.note('Файла .env нет — создаю из .env.example')
  writeFileSync('.env', readFileSync('.env.example', 'utf8'))
}
const supabaseOk = cachedCheck(
  'supabase',
  sha256(childEnv.SUPABASE_ACCESS_TOKEN ?? ''),
  () => run('npx supabase projects list -o json', { timeoutMs: 60_000 }).ok,
)
if (!supabaseOk) {
  report.note(
    'Нет доступа к Supabase CLI: до выкладки нужен SUPABASE_ACCESS_TOKEN в .env',
  )
} else {
  const refFile = 'supabase/.temp/project-ref'
  const linked =
    existsSync(refFile) && readFileSync(refFile, 'utf8').trim() === PROJECT_REF
  if (linked || run(`npx supabase link --project-ref ${PROJECT_REF}`).ok) {
    report.ok('Supabase CLI работает, проект привязан')
  } else {
    report.note(
      `Не удалось привязать проект ${PROJECT_REF}: повторить до выкладки`,
    )
  }
}
const missing = DEPLOY_VARIABLES.filter((name) => !hasEnv(name))
if (missing.length === 0) {
  report.ok('Переменные для выкладки на месте')
} else {
  report.note(
    `Для выкладки (до шага 6) не хватает в .env: ${missing.join(', ')}`,
  )
}

console.log(
  blocking === 0
    ? '\nГОТОВО: рабочее место подготовлено.'
    : `\nЕСТЬ ПРОБЛЕМЫ (${blocking}): см. строки [!!].`,
)
process.exitCode = blocking === 0 ? 0 : 1
