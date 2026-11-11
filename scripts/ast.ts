// Общие помощники обхода ESTree от oxc-parser для проверок в scripts/.

/** Узел ESTree от oxc-parser; поля читаются по мере необходимости. */
export type AstNode = {
  type: string
  start: number
  [key: string]: unknown
}

export function isNode(value: unknown): value is AstNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string'
  )
}

/** Дочерний узел по имени поля. */
export function child(node: AstNode | undefined, key: string) {
  const value = node?.[key]
  return isNode(value) ? value : undefined
}

/** Дочерние узлы поля-массива. */
export function children(node: AstNode | undefined, key: string) {
  const value = node?.[key]
  return Array.isArray(value) ? value.filter(isNode) : []
}

/** Имя идентификатора или значение строкового литерала. */
export function keyName(node: AstNode | undefined) {
  const value = node?.['name'] ?? node?.['value']
  return typeof value === 'string' ? value : undefined
}

/** Номер строки (с 1) для смещения в исходнике. */
export function lineAt(source: string, offset: number) {
  let line = 1
  for (let index = 0; index < offset; index += 1)
    if (source.charCodeAt(index) === 10) line += 1
  return line
}

/**
 * Обходит дерево в глубину. Если `enter` вернул `false`, потомки узла
 * не посещаются.
 */
export function walk(root: unknown, enter: (node: AstNode) => boolean | void) {
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (!isNode(value)) return
    if (enter(value) === false) return
    for (const key of Object.keys(value))
      if (key !== 'parent' && typeof value[key] === 'object') visit(value[key])
  }
  visit(root)
}
