// Проверка единой системы стилей (часть `npm run check`): Tailwind — единственный
// способ оформления. Правила — в style-rules.ts, описание — docs/design-system.md.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { __unstable__loadDesignSystem } from '@tailwindcss/node'
import {
  STYLESHEET,
  findExtraStylesheets,
  inspectCandidates,
  inspectComponentSource,
  inspectStylesheet,
} from './style-rules.ts'

const root = process.cwd()
const files = execFileSync(
  'git',
  [
    '-c',
    `safe.directory=${root}`,
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    '-z',
    '--',
    'src',
    'stories',
  ],
  { cwd: root, encoding: 'utf8' },
)
  .split('\0')
  .filter(Boolean)

const css = readFileSync(join(root, STYLESHEET), 'utf8')
const designSystem = await __unstable__loadDesignSystem(css, {
  base: join(root, 'src'),
})

const findings = [...findExtraStylesheets(files), ...inspectStylesheet(css)]
for (const file of files.filter((path) => /\.[cm]?[jt]sx?$/.test(path))) {
  if (/\.test\.[jt]sx?$/.test(file)) continue
  const source = readFileSync(join(root, file), 'utf8')
  const result = inspectComponentSource(source, file)
  findings.push(
    ...result.findings,
    ...inspectCandidates(result.candidates, file, designSystem),
  )
}

if (findings.length > 0) {
  console.error('Нарушены правила единой системы стилей (Tailwind):')
  for (const finding of findings) console.error(`- ${finding}`)
  process.exit(1)
}
console.log('Правила стилей соблюдены: только Tailwind и токены темы.')
