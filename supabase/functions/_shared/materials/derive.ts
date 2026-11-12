import { MATERIAL_LIMITS } from '../contracts/materials.ts'
import {
  extractText,
  type RichBlock,
  type RichDocument,
} from '../contracts/rich-text.ts'

/** Поля строки, которые сервис вычисляет из материала при сохранении. */
export type DerivedFields = {
  searchText: string
  excerpt: string
  coverUrl: string | null
}

/** Первое изображение по URL в документе, включая цитаты (карточка ленты). */
function firstImage(blocks: RichBlock[]): string | null {
  for (const block of blocks) {
    if (block.type === 'image') {
      return block.attrs.src
    }
    if (block.type === 'blockquote') {
      const nested = firstImage(block.content)
      if (nested) {
        return nested
      }
    }
  }
  return null
}

/** Обрезка по границе слова с многоточием. */
function clip(text: string, max: number) {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) {
    return flat
  }
  const cut = flat.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/**
 * Поиск (PUB-09, MKT-11) — заголовок, анонс, текст и имена вложений в нижнем
 * регистре; карточка — анонс или начало текста и первое изображение.
 */
export function deriveFields(input: {
  title: string
  summary: string | null
  content: RichDocument
  fileNames?: string[]
}): DerivedFields {
  const text = extractText(input.content)
  return {
    searchText: [
      input.title,
      input.summary ?? '',
      text,
      ...(input.fileNames ?? []),
    ]
      .join('\n')
      .toLowerCase(),
    excerpt: clip(input.summary ?? text, MATERIAL_LIMITS.excerpt),
    coverUrl: firstImage(input.content.content),
  }
}

/** Шаблон `ILIKE` для подстроки: спецсимволы `%`, `_` и `\` экранируются. */
export function likePattern(search: string) {
  return `%${search.toLowerCase().replace(/[\\%_]/g, (char) => `\\${char}`)}%`
}

/** Категории, чья подпись содержит строку поиска (поиск по категории). */
export function matchingCategories<C extends string>(
  labels: Record<C, string>,
  search: string,
): C[] {
  const needle = search.toLowerCase()
  return (Object.keys(labels) as C[]).filter((category) =>
    labels[category].toLowerCase().includes(needle),
  )
}
