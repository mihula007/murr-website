// Синхронизация локальной main с origin/main для session-prepare.ts (шаг 0).
// Своё незавершённое изменение из прошлого чата (неотправленные коммиты) —
// не ошибка: оно переносится поверх origin/main (rebase) и сообщается
// агенту, а он предлагает сопровождающему продолжить его или отказаться
// (AGENTS.md, шаг 0). Ошибка — только конфликт при переносе: тогда rebase
// отменяется и ничего не меняется.
import type { RunResult } from './local-env.ts'

export type SyncResult =
  | { kind: 'ok'; message: string; unfinished: string[] }
  | { kind: 'fail'; message: string }

/** Сводит main с уже полученной (fetch) origin/main. */
export function syncMain(git: (args: string) => RunResult): SyncResult {
  const [ahead = 0, behind = 0] = git(
    'rev-list --left-right --count main...origin/main',
  )
    .out.trim()
    .split(/\s+/)
    .map(Number)

  let message: string
  if (behind === 0) {
    message = 'main не отстаёт от origin/main'
  } else if (ahead === 0) {
    const pull = git('merge --ff-only origin/main')
    if (!pull.ok) {
      return {
        kind: 'fail',
        message: `Не удалось догнать origin/main:\n${tail(pull.out)}`,
      }
    }
    message = `main догнана до origin/main (+${behind} коммитов)`
  } else {
    const rebase = git('rebase origin/main')
    if (!rebase.ok) {
      git('rebase --abort')
      return {
        kind: 'fail',
        message:
          `main разошлась с origin/main (своих коммитов ${ahead}, чужих ${behind}), ` +
          `и перенос своих коммитов поверх origin/main даёт конфликт — ` +
          `ничего не изменено:\n${tail(rebase.out)}`,
      }
    }
    message = `свои коммиты (${ahead}) перенесены поверх origin/main (+${behind} коммитов)`
  }

  const unfinished = git(
    'log --reverse --oneline --no-decorate origin/main..main',
  )
    .out.split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  return { kind: 'ok', message, unfinished }
}

function tail(text: string): string {
  return text.trimEnd().split('\n').slice(-5).join('\n')
}
