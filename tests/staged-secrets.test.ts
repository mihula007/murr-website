// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'

const script = fileURLToPath(
  new URL('../scripts/check-secrets.ts', import.meta.url),
)
const temporaryPrefix = join(tmpdir(), 'murr-secret-check-')
const directories: string[] = []

function createFixture() {
  const directory = mkdtempSync(temporaryPrefix)
  directories.push(directory)
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', `safe.directory=${directory}`, ...args], {
      cwd: directory,
      stdio: 'ignore',
    })
  git('init', '--quiet')
  writeFileSync(
    join(directory, '.gitignore'),
    '.env\n.env.*\n*.env\n*.env.*\n!.env.example\n',
  )
  writeFileSync(join(directory, '.env.example'), 'TELEGRAM_BOT_TOKEN=\n')
  return { directory, git }
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    if (!resolve(directory).startsWith(resolve(temporaryPrefix))) {
      throw new Error(
        'Refusing to remove a path outside the test fixture prefix',
      )
    }
    rmSync(directory, { recursive: true, force: true })
  }
})

it('rejects a staged secret even after the working copy is cleaned', () => {
  const { directory, git } = createFixture()
  const path = join(directory, 'credential-canary.txt')
  const syntheticCredential = ['sb', 'secret', 'a'.repeat(32)].join('_')
  writeFileSync(path, syntheticCredential)
  git('add', 'credential-canary.txt')
  writeFileSync(path, 'No secret in the working copy.\n')

  const result = spawnSync(process.execPath, [script], {
    cwd: directory,
    encoding: 'utf8',
  })
  expect(result.status).toBe(1)
  expect(result.stderr).toContain('Supabase secret key')
  expect(result.stderr).not.toContain(syntheticCredential)
})

it('rejects a staged populated template even if the working template is empty', () => {
  const { directory, git } = createFixture()
  const path = join(directory, '.env.example')
  writeFileSync(path, 'TELEGRAM_BOT_TOKEN=synthetic-private-value\n')
  git('add', '.env.example')
  writeFileSync(path, 'TELEGRAM_BOT_TOKEN=\n')

  const result = spawnSync(process.execPath, [script], {
    cwd: directory,
    encoding: 'utf8',
  })
  expect(result.status).toBe(1)
  expect(result.stderr).toContain('TELEGRAM_BOT_TOKEN')
  expect(result.stderr).not.toContain('synthetic-private-value')
})
