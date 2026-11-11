// Правила архитектуры, которые Oxlint не выражает (импорты и хранилища
// проверяет Oxlint, см. .oxlintrc.json). Описание — AGENTS.md, «Обязательный стек».
import { parseSync } from 'oxc-parser'
import { child, keyName, lineAt, walk } from './ast.ts'

/** Единственная Edge Function проекта (решение владельца). */
export const EDGE_FUNCTIONS = ['api'] as const

/** Каталоги компонентов, для каждого файла которых обязательна история. */
export const STORY_REQUIRED = ['src/components/ui/', 'src/components/states/']

/** Методы Kysely, начинающие SQL-запрос. */
const QUERY_METHODS = new Set([
  'selectFrom',
  'selectNoFrom',
  'insertInto',
  'replaceInto',
  'updateTable',
  'deleteFrom',
  'mergeInto',
])

const normalize = (path: string) => path.replaceAll('\\', '/')

/** Файл, где допустим SQL: репозиторий или слой подключения к БД. */
export function isSqlAllowed(path: string) {
  const file = normalize(path)
  return /(?:^|\/)repository\.ts$/.test(file) || file.includes('/_shared/db/')
}

/**
 * SQL пишется только в репозиториях: в остальном серверном коде нет вызовов
 * построителя запросов (`db.selectFrom(...)` и т. п.).
 */
export function inspectServerSource(path: string, source: string): string[] {
  const file = normalize(path)
  if (isSqlAllowed(file)) {
    return []
  }
  const { program, errors } = parseSync(file, source)
  if (errors.length > 0) {
    return [`${file}: не удалось разобрать файл`]
  }
  const findings: string[] = []
  walk(program, (node) => {
    if (node.type !== 'CallExpression') {
      return
    }
    const callee = child(node, 'callee')
    if (callee?.type !== 'MemberExpression') {
      return
    }
    const method = keyName(child(callee, 'property'))
    if (method && QUERY_METHODS.has(method)) {
      findings.push(
        `${file}:${lineAt(source, node.start)}: запрос «${method}» вне репозитория — SQL только в <модуль>/repository.ts`,
      )
    }
  })
  return findings
}

/** Пути модулей, импортируемых файлом (статические и динамические импорты). */
export function importedModules(path: string, source: string): string[] {
  const { program } = parseSync(normalize(path), source)
  const modules: string[] = []
  walk(program, (node) => {
    if (
      node.type === 'ImportDeclaration' ||
      node.type === 'ExportNamedDeclaration' ||
      node.type === 'ExportAllDeclaration' ||
      node.type === 'ImportExpression'
    ) {
      const value = keyName(child(node, 'source'))
      if (value) {
        modules.push(value)
      }
    }
  })
  return modules
}

/** Разрешает относительный импорт истории в путь от корня без расширения. */
function resolveFrom(storyPath: string, specifier: string) {
  if (specifier.startsWith('@/')) {
    return `src/${specifier.slice(2)}`
  }
  if (!specifier.startsWith('.')) {
    return null
  }
  const parts = normalize(storyPath).split('/').slice(0, -1)
  for (const segment of specifier.split('/')) {
    if (segment === '..') {
      parts.pop()
    } else if (segment !== '.') {
      parts.push(segment)
    }
  }
  return parts.join('/').replace(/\.(?:tsx?|jsx?)$/, '')
}

/**
 * Каждый компонент `src/components/ui` и `src/components/states` показан в
 * Storybook: его файл импортирует хотя бы одна история.
 */
export function findComponentsWithoutStories(
  componentPaths: string[],
  stories: { path: string; source: string }[],
): string[] {
  const covered = new Set<string>()
  for (const story of stories) {
    for (const specifier of importedModules(story.path, story.source)) {
      const target = resolveFrom(story.path, specifier)
      if (target) {
        covered.add(target)
      }
    }
  }
  return componentPaths
    .map(normalize)
    .filter(
      (path) =>
        path.endsWith('.tsx') &&
        STORY_REQUIRED.some((dir) => path.startsWith(dir)),
    )
    .filter((path) => !covered.has(path.replace(/\.tsx$/, '')))
    .map(
      (path) =>
        `${path}: нет истории Storybook — добавьте пример в stories/*.stories.tsx`,
    )
}

/**
 * Ровно одна Edge Function — `api`. Каталоги `supabase/functions/*`, кроме
 * общего `_shared`, считаются функциями.
 */
export function inspectEdgeFunctions(directories: string[]): string[] {
  const functions = directories.filter((name) => !name.startsWith('_'))
  const findings = functions
    .filter((name) => !(EDGE_FUNCTIONS as readonly string[]).includes(name))
    .map(
      (name) =>
        `supabase/functions/${name}: новая Edge Function — только по решению владельца (обязательна одна функция api)`,
    )
  for (const name of EDGE_FUNCTIONS) {
    if (!functions.includes(name)) {
      findings.push(`supabase/functions/${name}: отсутствует функция ${name}`)
    }
  }
  return findings
}
