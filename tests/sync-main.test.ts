// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { syncMain } from '../scripts/sync-main.ts'

const directories: string[] = []
const identity = ['-c', 'user.name=t', '-c', 'user.email=t@example.test']

function git(cwd: string, args: string[]) {
  const result = spawnSync('git', [...identity, ...args], {
    cwd,
    encoding: 'utf8',
  })
  return { ok: result.status === 0, out: `${result.stdout}${result.stderr}` }
}

function commit(cwd: string, file: string, text: string, message: string) {
  writeFileSync(join(cwd, file), text)
  git(cwd, ['add', file])
  git(cwd, ['commit', '-q', '-m', message])
}

/** origin с одним коммитом и его клон в main. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'murr-sync-main-'))
  directories.push(root)
  const origin = join(root, 'origin')
  const clone = join(root, 'clone')
  mkdirSync(origin)
  git(origin, ['init', '-q', '-b', 'main'])
  git(origin, ['config', 'receive.denyCurrentBranch', 'ignore'])
  commit(origin, 'a.txt', 'a\n', 'base')
  git(root, ['clone', '-q', origin, clone])
  const sync = () => {
    git(clone, ['fetch', '-q', 'origin'])
    return syncMain((args) => git(clone, args.split(' ').filter(Boolean)))
  }
  const head = () => git(clone, ['log', '--format=%s', 'main']).out.trim()
  return { origin, clone, sync, head }
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

it('ничего не делает, если main совпадает с origin/main', () => {
  const { sync } = fixture()
  expect(sync()).toEqual({
    kind: 'ok',
    message: 'main не отстаёт от origin/main',
    unfinished: [],
  })
})

it('догоняет origin/main без своих коммитов', () => {
  const { origin, sync, head } = fixture()
  commit(origin, 'b.txt', 'b\n', 'remote')
  const result = sync()
  expect(result).toMatchObject({ kind: 'ok', unfinished: [] })
  expect(head()).toBe('remote\nbase')
}, 15_000)

it('сообщает о своих неотправленных коммитах как о незавершённом изменении', () => {
  const { clone, sync } = fixture()
  commit(clone, 'c.txt', 'c\n', 'feat: local')
  const result = sync()
  expect(result.kind).toBe('ok')
  expect(result.kind === 'ok' && result.unfinished).toEqual([
    expect.stringMatching(/^[0-9a-f]+ feat: local$/),
  ])
})

it('переносит свои коммиты поверх origin/main при расхождении', () => {
  const { origin, clone, sync, head } = fixture()
  commit(origin, 'b.txt', 'b\n', 'remote')
  commit(clone, 'c.txt', 'c\n', 'feat: local')
  const result = sync()
  expect(result).toMatchObject({ kind: 'ok' })
  expect(result.kind === 'ok' && result.unfinished).toHaveLength(1)
  expect(head()).toBe('feat: local\nremote\nbase')
})

it('при конфликте отменяет перенос и ничего не меняет', () => {
  const { origin, clone, sync, head } = fixture()
  commit(origin, 'a.txt', 'remote\n', 'remote')
  commit(clone, 'a.txt', 'local\n', 'feat: local')
  const result = sync()
  expect(result.kind).toBe('fail')
  expect(head()).toBe('feat: local\nbase')
  expect(git(clone, ['status', '--porcelain']).out).toBe('')
})
