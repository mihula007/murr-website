import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import { inspectContent, inspectTemplate } from './secret-rules.ts'

const root = process.cwd()
const git = (...args: string[]) =>
  execFileSync('git', ['-c', `safe.directory=${root}`, ...args], {
    cwd: root,
    encoding: 'utf8',
  })

const tracked = git('ls-files', '--cached', '-z').split('\0').filter(Boolean)
const files = git(
  'ls-files',
  '--cached',
  '--others',
  '--exclude-standard',
  '-z',
)
  .split('\0')
  .filter(Boolean)
const findings: string[] = []
const isEnvTemplate = (path: string) => path === '.env.example'
const isEnvFile = (path: string) =>
  !isEnvTemplate(path) && /(?:^|\.)env(?:\.|$)/.test(basename(path))

for (const path of tracked.filter(isEnvFile)) {
  findings.push(`${path}: env-файл не должен отслеживаться Git`)
}

const envProbes = [
  '.env',
  '.env.local',
  '.env.production',
  'supabase/functions/.env',
  'backend.env',
]
const ignored = git('check-ignore', '--no-index', '--', ...envProbes)
  .trim()
  .split(/\r?\n/)
for (const path of envProbes) {
  if (!ignored.includes(path)) {
    findings.push(`${path}: отсутствует правило gitignore`)
  }
}

const templatePath = join(root, '.env.example')
if (!existsSync(templatePath)) {
  findings.push('Отсутствует обязательный .env.example')
} else {
  findings.push(
    ...inspectTemplate(readFileSync(templatePath, 'utf8')).map(
      (finding) => `.env.example: ${finding}`,
    ),
  )
}

// Inspect text only, including tracked legacy material, without displaying values.
const textFile =
  /(?:\.(?:[cm]?[jt]sx?|json|html?|css|md|txt|toml|ya?ml|sql|sh|ps1|pem)|(?:^|\/)\.[^/]+)$/i
for (const path of new Set(files)) {
  if (isEnvFile(path) || !textFile.test(path) || !existsSync(path)) {
    continue
  }
  const content = readFileSync(path, 'utf8')
  findings.push(
    ...inspectContent(content).map((finding) => `${path}: ${finding}`),
  )
}

// The index may differ from the working tree; inspect exactly what a commit keeps.
const staged = git(
  'diff',
  '--cached',
  '--name-only',
  '--diff-filter=ACMR',
  '-z',
)
  .split('\0')
  .filter(Boolean)
for (const path of staged) {
  if (isEnvFile(path) || !textFile.test(path)) {
    continue
  }
  const content = git('show', `:${path}`)
  findings.push(
    ...inspectContent(content).map((finding) => `index:${path}: ${finding}`),
  )
  if (isEnvTemplate(path)) {
    findings.push(
      ...inspectTemplate(content).map((finding) => `index:${path}: ${finding}`),
    )
  }
}

function scanBuild(directory: string) {
  if (!existsSync(directory)) {
    return
  }
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      scanBuild(path)
    } else if (textFile.test(path)) {
      findings.push(
        ...inspectContent(readFileSync(path, 'utf8')).map(
          (finding) => `${relative(root, path)}: ${finding}`,
        ),
      )
    }
  }
}
scanBuild(join(root, 'dist'))

if (findings.length) {
  console.error('Проверка секретов не пройдена (значения скрыты):')
  for (const finding of findings) {
    console.error(`- ${finding}`)
  }
  process.exitCode = 1
} else {
  console.log(
    'Проверка секретов: env-файлы исключены, шаблон пуст, известные токены не обнаружены.',
  )
}
