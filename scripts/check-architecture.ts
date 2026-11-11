// Проверка архитектуры (часть `npm run check`): SQL только в репозиториях,
// история Storybook для каждого компонента ui/states, одна Edge Function.
// Правила — в architecture-rules.ts; импорты и хранилища проверяет Oxlint.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  findComponentsWithoutStories,
  inspectEdgeFunctions,
  inspectServerSource,
} from './architecture-rules.ts'

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
    'supabase/functions',
  ],
  { cwd: root, encoding: 'utf8' },
)
  .split('\0')
  .filter((path) => path && existsSync(join(root, path)))
const read = (path: string) => readFileSync(join(root, path), 'utf8')

const findings: string[] = []

for (const path of files.filter(
  (file) => file.startsWith('supabase/functions/') && file.endsWith('.ts'),
))
  findings.push(...inspectServerSource(path, read(path)))

findings.push(
  ...findComponentsWithoutStories(
    files.filter((file) => file.startsWith('src/components/')),
    files
      .filter((file) => file.endsWith('.stories.tsx'))
      .map((path) => ({ path, source: read(path) })),
  ),
)

findings.push(
  ...inspectEdgeFunctions(
    readdirSync(join(root, 'supabase/functions'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
  ),
)

if (findings.length > 0) {
  console.error('Нарушены правила архитектуры:')
  for (const finding of findings) console.error(`- ${finding}`)
  process.exit(1)
}
console.log(
  'Правила архитектуры соблюдены: SQL в репозиториях, истории компонентов, одна Edge Function.',
)
