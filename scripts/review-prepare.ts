// Шаг 4 процесса сопровождающего (AGENTS.md): готовит локальный стек к
// ручной проверке одной командой —
//   1. дожидается фонового `supabase start` из session-prepare.ts (или
//      запускает стек сам);
//   2. применяет новые миграции к локальной базе (`migration up`);
//   3. записывает публичные ключи стека для Vite (`supabase-env.ts`);
//   4. пересоздаёт тестовые данные (`seed-dev.ts --reset`) — серверные тесты
//      и e2e очищают таблицы, поэтому перед каждым показом.
// Долгие процессы (`npm run e2e:functions`, `npm run dev`) агент запускает
// сам в фоне после этой команды. Только локальный стек.
// Запуск: npm run review:prepare
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { TEST_PASSWORD } from '../tests/server/support.ts'
import {
  STATE_DIR,
  isProcessAlive,
  localStackRunning,
  report,
  run,
  sleep,
  tail,
} from './local-env.ts'

const START_PID = `${STATE_DIR}/supabase-start.pid`
const START_LOG = `${STATE_DIR}/supabase-start.log`

function stop(message: string): never {
  report.fail(message)
  process.exit(1)
}

report.step('Локальный Supabase')
if (existsSync(START_PID)) {
  const pid = Number(readFileSync(START_PID, 'utf8'))
  if (isProcessAlive(pid)) {
    report.note('Жду фоновый запуск Supabase…')
    for (let waited = 0; isProcessAlive(pid); waited += 3_000) {
      if (waited > 15 * 60_000) {
        stop(
          `Фоновый запуск Supabase идёт больше 15 минут; журнал ${START_LOG}`,
        )
      }
      await sleep(3_000)
    }
  }
  rmSync(START_PID)
}
if (!localStackRunning()) {
  report.note('Стек не запущен — запускаю (npx supabase start -x studio)')
  const start = run('npx supabase start -x studio')
  if (!start.ok) {
    const log = existsSync(START_LOG)
      ? `\n${tail(readFileSync(START_LOG, 'utf8'))}`
      : ''
    stop(`Supabase не запустился:\n${tail(start.out)}${log}`)
  }
}
report.ok('Локальный Supabase запущен')

const steps: [string, string][] = [
  ['Миграции локальной базы', 'npx supabase migration up'],
  ['Ключи стека для сайта', 'node scripts/supabase-env.ts'],
  ['Тестовые данные', 'node scripts/seed-dev.ts --reset'],
]
for (const [title, command] of steps) {
  report.step(title)
  const result = run(command)
  if (!result.ok) {
    stop(`${command} не прошёл:\n${tail(result.out)}`)
  }
  report.ok(command)
}

console.log(`
ГОТОВО. Дальше в фоне: npm run e2e:functions и npm run dev.
Сайт: http://127.0.0.1:5173   Письма с кодами (Mailpit): http://127.0.0.1:54324
Входы: seed-admin@example.test, seed-officer-1@example.test, seed-member-1@example.test
Пароль: ${TEST_PASSWORD}`)
