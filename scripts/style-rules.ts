// Правила единой системы стилей: оформление задаётся только утилитами Tailwind.
import { parseSync } from 'oxc-parser'
import {
  child,
  children,
  isNode,
  keyName,
  lineAt,
  walk,
  type AstNode,
} from './ast.ts'

export type ClassCandidate = { name: string; line: number }
export type DesignSystemLike = {
  candidatesToCss(classes: string[]): (string | null)[]
}
type StringPart = { value: string; start: number }

/** Единственный разрешённый файл стилей. */
export const STYLESHEET = 'src/styles.css'

/** Классы-маркеры Tailwind, которые сами не дают CSS, но нужны вариантам. */
const MARKER_CLASSES = new Set(['group', 'peer'])
const MARKER_PATTERN = /^(?:group|peer)\/[\w-]+$/

const STYLE_FILE = /\.(?:css|scss|sass|less|styl|pcss|postcss)$/i
const RAW_COLOR =
  /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i
const CLASS_SELECTOR = /\.-?[a-z_]/i
const TOP_LEVEL_ALLOWED = [
  /^@import\s/,
  /^@custom-variant\s/,
  /^:root$/,
  /^@theme(?:\s+inline)?$/,
  /^@layer\s+base$/,
]
/**
 * Единственное исключение для `style` (решение владельца 11.11.2026):
 * геометрия виртуализированных списков вычисляется во время работы и
 * передаётся CSS-переменными `--virtual-*` только из этого файла.
 */
export const VIRTUAL_GEOMETRY_FILE = 'src/components/virtual-list.tsx'
const VIRTUAL_VARIABLE = /^--virtual-[a-z-]+$/

/** `style={{ '--virtual-…': … }}` (возможно, с `as CSSProperties`). */
function isVirtualGeometryStyle(attribute: AstNode) {
  let expression = child(child(attribute, 'value'), 'expression')
  while (expression?.type === 'TSAsExpression') {
    expression = child(expression, 'expression')
  }
  if (expression?.type !== 'ObjectExpression') {
    return false
  }
  const properties = children(expression, 'properties')
  return (
    properties.length > 0 &&
    properties.every(
      (property) =>
        property.type === 'Property' &&
        VIRTUAL_VARIABLE.test(keyName(child(property, 'key')) ?? ''),
    )
  )
}

const CLASS_HELPERS = new Set(['cn', 'clsx', 'cx', 'twMerge'])
const CLASS_VARIABLE = /class(?:es|name|names)?$/i
const CLASS_PROPERTY = /^class(?:Name|Names)?$/

/** Файлы стилей, кроме разрешённого `src/styles.css`. */
export function findExtraStylesheets(paths: string[]): string[] {
  return paths
    .map((path) => path.replaceAll('\\', '/'))
    .filter((path) => STYLE_FILE.test(path) && path !== STYLESHEET)
    .map(
      (path) => `${path}: отдельные файлы стилей запрещены — только Tailwind`,
    )
}

/** Убирает комментарии, сохраняя переводы строк для номеров строк. */
function stripComments(css: string) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
    comment.replace(/[^\n]/g, ' '),
  )
}

/**
 * Проверяет `src/styles.css`: на верхнем уровне только импорты, `:root`,
 * `@theme` и `@layer base`; нигде нет селекторов классов, `@utility`
 * и вложенных слоёв; цвета-литералы только в `:root`.
 */
export function inspectStylesheet(css: string, file = STYLESHEET): string[] {
  const source = stripComments(css)
  const findings: string[] = []
  const stack: string[] = []
  let start = 0
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (char === '"' || char === "'") {
      const end = source.indexOf(char, index + 1)
      index = end === -1 ? source.length : end
      continue
    }
    if (char !== '{' && char !== '}' && char !== ';') {
      continue
    }
    const text = source.slice(start, index).trim()
    const line = lineAt(source, start + source.slice(start).search(/\S|$/))
    const where = `${file}:${line}`
    if (char === '{') {
      if (
        stack.length === 0 &&
        !TOP_LEVEL_ALLOWED.some((re) => re.test(text))
      ) {
        findings.push(
          `${where}: блок «${text}» запрещён — в styles.css только импорты, :root, @theme и @layer base`,
        )
      }
      if (
        /^@(?:utility|layer|tailwind|apply)\b/.test(text) &&
        stack.length > 0
      ) {
        findings.push(`${where}: «${text}» запрещён внутри блоков`)
      }
      if (!text.startsWith('@') && CLASS_SELECTOR.test(text)) {
        findings.push(
          `${where}: селектор класса «${text}» — оформляйте утилитами в разметке`,
        )
      }
      stack.push(text)
    } else if (text) {
      // Объявление или at-правило без блока (`;` или последнее перед `}`).
      if (stack.length === 0 && !/^@(?:import|custom-variant)\s/.test(text)) {
        findings.push(
          `${where}: «${text}» запрещён на верхнем уровне styles.css`,
        )
      }
      if (!stack.includes(':root') && RAW_COLOR.test(text)) {
        findings.push(
          `${where}: цвет-литерал «${text}» вне :root — добавьте токен`,
        )
      }
    }
    if (char === '}') {
      stack.pop()
    }
    start = index + 1
  }
  return findings
}

/** Все строки-литералы выражения, где ожидаются классы. */
function collectStrings(node: unknown, out: StringPart[]) {
  if (!isNode(node)) {
    return
  }
  switch (node.type) {
    case 'Literal':
      if (typeof node['value'] === 'string') {
        out.push({ value: node['value'], start: node.start })
      }
      return
    case 'TemplateLiteral': {
      // Части рядом с подстановкой — неполные классы, их не проверяем.
      const quasis = children(node, 'quasis')
      quasis.forEach((quasi, index) => {
        const value = quasi['value'] as { cooked?: string | null } | undefined
        let tokens = (value?.cooked ?? '').split(/\s+/)
        if (index > 0) {
          tokens = tokens.slice(1)
        }
        if (index < quasis.length - 1) {
          tokens = tokens.slice(0, -1)
        }
        out.push({ value: tokens.join(' '), start: quasi.start })
      })
      return
    }
    case 'ConditionalExpression':
      collectStrings(node['consequent'], out)
      collectStrings(node['alternate'], out)
      return
    case 'LogicalExpression':
      collectStrings(node['left'], out)
      collectStrings(node['right'], out)
      return
    case 'ArrayExpression':
      for (const element of children(node, 'elements')) {
        collectStrings(element, out)
      }
      return
    case 'ObjectExpression':
      // Объект clsx/cn: ключи — классы.
      for (const property of children(node, 'properties')) {
        const key = child(property, 'key')
        if (property.type === 'Property' && key?.type === 'Literal') {
          collectStrings(key, out)
        }
      }
      return
    case 'ParenthesizedExpression':
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
    case 'JSXExpressionContainer':
      collectStrings(node['expression'], out)
      return
    case 'CallExpression': {
      const callee = keyName(child(node, 'callee'))
      if (callee && CLASS_HELPERS.has(callee)) {
        for (const argument of children(node, 'arguments')) {
          collectStrings(argument, out)
        }
      } else if (callee === 'cva') {
        collectCva(node, out)
      }
      return
    }
    default:
  }
}

/** cva: базовые классы, значения вариантов и классы compoundVariants. */
function collectCva(node: AstNode, out: StringPart[]) {
  const [base, config] = children(node, 'arguments')
  collectStrings(base, out)
  if (config?.type !== 'ObjectExpression') {
    return
  }
  for (const property of children(config, 'properties')) {
    const key = keyName(child(property, 'key'))
    const value = child(property, 'value')
    if (key === 'variants' && value?.type === 'ObjectExpression') {
      for (const variant of children(value, 'properties')) {
        const options = child(variant, 'value')
        if (options?.type === 'ObjectExpression') {
          for (const option of children(options, 'properties')) {
            collectStrings(option['value'], out)
          }
        }
      }
    }
    if (key === 'compoundVariants' && value?.type === 'ArrayExpression') {
      for (const item of children(value, 'elements')) {
        for (const field of children(item, 'properties')) {
          if (CLASS_PROPERTY.test(keyName(child(field, 'key')) ?? '')) {
            collectStrings(field['value'], out)
          }
        }
      }
    }
  }
}

/**
 * Разбирает TS/TSX-файл: кандидаты в классы (атрибуты className, вызовы
 * cn/clsx/cva, константы `*Class`/`*Classes`, свойства `className(s)`)
 * и находки — inline-стили через атрибут `style`.
 */
export function inspectComponentSource(
  source: string,
  file: string,
): { candidates: ClassCandidate[]; findings: string[] } {
  const { program, errors } = parseSync(file, source)
  if (errors.length > 0) {
    return {
      candidates: [],
      findings: [`${file}: не удалось разобрать файл для проверки стилей`],
    }
  }
  const strings: StringPart[] = []
  const findings: string[] = []
  walk(program, (node) => {
    if (node.type === 'JSXAttribute') {
      const name = keyName(child(node, 'name'))
      if (
        name === 'style' &&
        !(file === VIRTUAL_GEOMETRY_FILE && isVirtualGeometryStyle(node))
      ) {
        findings.push(
          `${file}:${lineAt(source, node.start)}: inline-стиль — используйте утилиты Tailwind`,
        )
      }
      if (name === 'className' || name === 'class') {
        collectStrings(node['value'], strings)
        return false
      }
    } else if (node.type === 'CallExpression') {
      const callee = keyName(child(node, 'callee'))
      if (callee && (CLASS_HELPERS.has(callee) || callee === 'cva')) {
        collectStrings(node, strings)
        return false
      }
    } else if (
      node.type === 'VariableDeclarator' &&
      CLASS_VARIABLE.test(keyName(child(node, 'id')) ?? '')
    ) {
      collectStrings(node['init'], strings)
      return false
    } else if (
      node.type === 'Property' &&
      CLASS_PROPERTY.test(keyName(child(node, 'key')) ?? '')
    ) {
      const value = child(node, 'value')
      if (value?.type === 'ObjectExpression') {
        for (const field of children(value, 'properties')) {
          collectStrings(field['value'], strings)
        }
      } else {
        collectStrings(value, strings)
      }
      return false
    }
    return true
  })
  const candidates = strings.flatMap(({ value, start }) =>
    value
      .split(/\s+/)
      .filter(Boolean)
      .map((name) => ({ name, line: lineAt(source, start) })),
  )
  return { candidates, findings }
}

/**
 * Проверяет классы по дизайн-системе Tailwind: класс должен порождать CSS
 * (иначе это собственный класс, опечатка или отключённая палитра), а
 * произвольные значения не должны содержать цвета-литералы.
 */
export function inspectCandidates(
  candidates: ClassCandidate[],
  file: string,
  designSystem: DesignSystemLike,
): string[] {
  const findings: string[] = []
  const unique = [...new Set(candidates.map(({ name }) => name))].filter(
    (name) => !MARKER_CLASSES.has(name) && !MARKER_PATTERN.test(name),
  )
  const css = designSystem.candidatesToCss(unique)
  const unknown = new Set(unique.filter((_, index) => css[index] === null))
  const reported = new Set<string>()
  for (const { name, line } of candidates) {
    const key = `${line}:${name}`
    if (reported.has(key)) {
      continue
    }
    if (unknown.has(name)) {
      reported.add(key)
      findings.push(
        `${file}:${line}: «${name}» не является утилитой Tailwind — собственные классы и стандартная палитра запрещены`,
      )
    } else if (name.includes('[') && RAW_COLOR.test(name)) {
      reported.add(key)
      findings.push(
        `${file}:${line}: цвет-литерал в «${name}» — используйте токен темы`,
      )
    }
  }
  return findings
}
