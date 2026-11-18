// Самовосстановление после битых служебных ссылок Codex.
// Приложение Codex хранит снимки изменений каждого хода как скрытые ссылки
// `refs/codex/…` в репозитории. Если объект такого снимка пропал (сборка
// мусора, прерванный ход), `git fetch` падает на проверке связности
// («bad object refs/codex/…») и не даёт обновить main. Сами снимки проекту
// не нужны: удаляем их и повторяем fetch (session-prepare.ts).
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CODEX_PREFIX = 'refs/codex/'

/** Вывод git сообщает о битой ссылке Codex. */
export function isCodexRefFailure(gitOutput: string): boolean {
  return /bad object refs\/codex\//.test(gitOutput)
}

/**
 * packed-refs без ссылок Codex: строка `<sha> refs/codex/…` и следующие за
 * ней строки `^<sha>` (очищенный тег) удаляются, остальное без изменений.
 */
export function withoutCodexRefs(packedRefs: string): string {
  const kept: string[] = []
  let skipping = false
  for (const line of packedRefs.split('\n')) {
    if (line.startsWith('^')) {
      if (!skipping) {
        kept.push(line)
      }
      continue
    }
    const ref = line.split(' ')[1] ?? ''
    skipping = ref.startsWith(CODEX_PREFIX)
    if (!skipping) {
      kept.push(line)
    }
  }
  return kept.join('\n')
}

/**
 * Удаляет все ссылки `refs/codex/…` в общей папке git (`git rev-parse
 * --git-common-dir`): файлы ссылок и строки packed-refs. Работает с файлами
 * напрямую — `git update-ref` и `for-each-ref` пропускают битые ссылки.
 */
export function removeCodexRefs(gitCommonDir: string): void {
  rmSync(join(gitCommonDir, 'refs', 'codex'), { recursive: true, force: true })
  const packedPath = join(gitCommonDir, 'packed-refs')
  if (existsSync(packedPath)) {
    const packed = readFileSync(packedPath, 'utf8')
    const cleaned = withoutCodexRefs(packed)
    if (cleaned !== packed) {
      writeFileSync(packedPath, cleaned)
    }
  }
  rmSync(join(gitCommonDir, 'logs', 'refs', 'codex'), {
    recursive: true,
    force: true,
  })
}
