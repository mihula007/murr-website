// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import {
  isCodexRefFailure,
  removeCodexRefs,
  withoutCodexRefs,
} from '../scripts/codex-refs.ts'

const directories: string[] = []
const MISSING = '1738f12c92894c398c18c1054b923a7e00000000'

function git(cwd: string, ...args: string[]) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  return { ok: result.status === 0, out: `${result.stdout}${result.stderr}` }
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

it('распознаёт ошибку fetch из-за битой ссылки Codex', () => {
  expect(
    isCodexRefFailure(
      'fatal: bad object refs/codex/turn-diffs/captures/1/2/base\nerror: x',
    ),
  ).toBe(true)
  expect(isCodexRefFailure('fatal: bad object refs/heads/main')).toBe(false)
})

it('убирает из packed-refs только ссылки Codex с очищенными тегами', () => {
  const packed = [
    '# pack-refs with: peeled fully-peeled sorted',
    'aaa refs/codex/turn-diffs/captures/1/2/base',
    '^bbb',
    'ccc refs/heads/main',
    'ddd refs/tags/v1',
    '^eee',
    '',
  ].join('\n')
  expect(withoutCodexRefs(packed)).toBe(
    [
      '# pack-refs with: peeled fully-peeled sorted',
      'ccc refs/heads/main',
      'ddd refs/tags/v1',
      '^eee',
      '',
    ].join('\n'),
  )
})

it('после удаления битых ссылок Codex fetch снова проходит', () => {
  const root = mkdtempSync(join(tmpdir(), 'murr-codex-refs-'))
  directories.push(root)
  const origin = join(root, 'origin')
  const clone = join(root, 'clone')
  mkdirSync(origin)
  git(origin, 'init', '-q', '-b', 'main')
  git(
    origin,
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@example.test',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'one',
  )
  git(root, 'clone', '-q', origin, clone)
  git(
    origin,
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@example.test',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'two',
  )

  const gitDir = join(clone, '.git')
  mkdirSync(join(gitDir, 'refs', 'codex', 'captures', 'x'), { recursive: true })
  writeFileSync(
    join(gitDir, 'refs', 'codex', 'captures', 'x', 'base'),
    `${MISSING}\n`,
  )
  writeFileSync(
    join(gitDir, 'packed-refs'),
    `# pack-refs with: peeled fully-peeled sorted\n${MISSING} refs/codex/captures/y/base\n`,
  )

  const broken = git(clone, 'fetch', 'origin')
  expect(broken.ok).toBe(false)
  expect(isCodexRefFailure(broken.out)).toBe(true)

  removeCodexRefs(gitDir)
  expect(git(clone, 'fetch', 'origin').ok).toBe(true)
})
