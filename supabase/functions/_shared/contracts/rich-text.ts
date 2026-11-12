import { z } from 'zod'

/**
 * Документ редактора публикаций и объявлений (Q-57): JSON Tiptap,
 * ограниченный белым списком узлов, меток и атрибутов. Схема — единственный
 * источник правил: сервер отклоняет документ, не прошедший её, клиент
 * проверяет документ ещё раз перед показом. HTML нигде не хранится.
 */
export const RICH_TEXT_LIMITS = {
  /** Размер документа в JSON, символов. */
  jsonChars: 100_000,
  /** Видимый текст документа, символов. */
  textChars: 20_000,
  /** Изображения по URL и видео в одном документе. */
  media: 20,
  tableRows: 20,
  tableColumns: 10,
  /** Глубина вложенности узлов (списки в списках, таблица в цитате…). */
  depth: 12,
  /** Всего узлов в документе. */
  nodes: 20_000,
  /** Уровни вложенности списков (PUB-10 «отступы»). */
  listDepth: 4,
  url: 2000,
  altText: 300,
} as const

/** Цвета текста — только токены темы (раздел «Дизайн» AGENTS.md). */
export const TEXT_TONES = [
  'gold',
  'highlight',
  'muted',
  'danger',
  'success',
] as const
export type TextTone = (typeof TEXT_TONES)[number]

export const TEXT_TONE_LABELS: Record<TextTone, string> = {
  gold: 'Золотой',
  highlight: 'Светлое золото',
  muted: 'Приглушённый',
  danger: 'Красный',
  success: 'Зелёный',
}

export const TEXT_SIZES = ['sm', 'lg', 'xl'] as const
export type TextSize = (typeof TEXT_SIZES)[number]

export const TEXT_SIZE_LABELS: Record<TextSize, string> = {
  sm: 'Мелкий',
  lg: 'Крупный',
  xl: 'Очень крупный',
}

export const TEXT_ALIGNS = ['left', 'center', 'right', 'justify'] as const
export type TextAlign = (typeof TEXT_ALIGNS)[number]

export const VIDEO_PROVIDERS = ['youtube', 'vk'] as const
export type VideoProvider = (typeof VIDEO_PROVIDERS)[number]

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/
const VK_ID = /^-?\d{1,19}_\d{1,19}$/

/** Идентификатор ролика допустим для провайдера (Q-56). */
export function isValidVideoId(provider: VideoProvider, id: string) {
  return provider === 'youtube' ? YOUTUBE_ID.test(id) : VK_ID.test(id)
}

/**
 * Распознаёт ссылку на ролик YouTube или VK (Q-56). Возвращает провайдера
 * и идентификатор; iframe клиент собирает сам, исходный URL не хранится.
 */
export function parseVideoUrl(
  input: string,
): { provider: VideoProvider; videoId: string } | null {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return null
  }
  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, '')
  const segments = url.pathname.split('/').filter(Boolean)
  const youtube = (id: string | null | undefined) =>
    id && YOUTUBE_ID.test(id)
      ? { provider: 'youtube' as const, videoId: id }
      : null
  if (host === 'youtu.be') {
    return youtube(segments[0])
  }
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (segments[0] === 'watch') {
      return youtube(url.searchParams.get('v'))
    }
    if (['shorts', 'embed', 'live'].includes(segments[0] ?? '')) {
      return youtube(segments[1])
    }
    return null
  }
  if (host === 'vk.com' || host === 'vk.ru' || host === 'vkvideo.ru') {
    const vk = (id: string | null | undefined) =>
      id && VK_ID.test(id) ? { provider: 'vk' as const, videoId: id } : null
    if (segments[0] === 'video_ext.php') {
      const oid = url.searchParams.get('oid')
      const id = url.searchParams.get('id')
      return oid && id ? vk(`${oid}_${id}`) : null
    }
    const fromPath = /^video(-?\d+_\d+)$/.exec(segments.at(-1) ?? '')
    if (fromPath) {
      return vk(fromPath[1])
    }
    const fromQuery = /^video(-?\d+_\d+)$/.exec(url.searchParams.get('z') ?? '')
    return fromQuery ? vk(fromQuery[1]) : null
  }
  return null
}

/** Адрес встроенного плеера строится только из проверенного идентификатора. */
export function videoEmbedUrl(provider: VideoProvider, videoId: string) {
  if (!isValidVideoId(provider, videoId)) {
    return null
  }
  if (provider === 'youtube') {
    return `https://www.youtube-nocookie.com/embed/${videoId}`
  }
  const [oid, id] = videoId.split('_')
  return `https://vk.com/video_ext.php?oid=${oid}&id=${id}`
}

const hasControlChars = (value: string) =>
  [...value].some(
    (char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f,
  )

/** URL без управляющих символов и пробелов, с разрешённым протоколом. */
function isSafeUrl(value: string, protocols: readonly string[]) {
  if (
    value.length > RICH_TEXT_LIMITS.url ||
    /\s/.test(value) ||
    hasControlChars(value)
  ) {
    return false
  }
  try {
    return protocols.includes(new URL(value).protocol)
  } catch {
    return false
  }
}

/** Ссылки: HTTP, HTTPS, mailto (PUB-12). */
export const isSafeLinkHref = (value: string) =>
  isSafeUrl(value, ['https:', 'http:', 'mailto:'])

/** Изображения по URL: только HTTPS (страница открыта по HTTPS). */
export const isSafeImageSrc = (value: string) => isSafeUrl(value, ['https:'])

// ---------------------------------------------------------------------------
// Типы документа

export type RichMark =
  | { type: 'bold' | 'italic' | 'underline' | 'strike' }
  | {
      type: 'link'
      attrs: {
        href: string
        target?: '_blank' | null | undefined
        rel?: string | null | undefined
        class?: null | undefined
      }
    }
  | { type: 'tone'; attrs: { tone: TextTone } }
  | { type: 'size'; attrs: { size: TextSize } }

export type RichText = {
  type: 'text'
  text: string
  marks?: RichMark[] | undefined
}

type AlignAttrs = { textAlign?: TextAlign | null | undefined }

export type RichInline = RichText | { type: 'hardBreak' }

export type RichParagraph = {
  type: 'paragraph'
  attrs?: AlignAttrs | undefined
  content?: RichInline[] | undefined
}

export type RichHeading = {
  type: 'heading'
  attrs: AlignAttrs & { level: 2 | 3 }
  content?: RichInline[] | undefined
}

export type RichListItem = {
  type: 'listItem'
  content: RichListItemChild[]
}

export type RichBulletList = { type: 'bulletList'; content: RichListItem[] }

export type RichOrderedList = {
  type: 'orderedList'
  attrs?: { start?: number | undefined; type?: null | undefined } | undefined
  content: RichListItem[]
}

export type RichListItemChild = RichParagraph | RichBulletList | RichOrderedList

export type RichCell = {
  type: 'tableCell' | 'tableHeader'
  attrs?:
    | {
        colspan?: number | undefined
        rowspan?: number | undefined
        colwidth?: number[] | null | undefined
      }
    | undefined
  content: RichParagraph[]
}

export type RichTable = {
  type: 'table'
  content: { type: 'tableRow'; content: RichCell[] }[]
}

export type RichImage = {
  type: 'image'
  attrs: {
    src: string
    alt?: string | null | undefined
    title?: string | null | undefined
    width?: null | undefined
    height?: null | undefined
  }
}

export type RichVideo = {
  type: 'video'
  attrs: { provider: VideoProvider; videoId: string }
}

export type RichBlock =
  | RichParagraph
  | RichHeading
  | { type: 'blockquote'; content: RichBlock[] }
  | RichBulletList
  | RichOrderedList
  | { type: 'horizontalRule' }
  | RichTable
  | RichImage
  | RichVideo

export type RichDocument = { type: 'doc'; content: RichBlock[] }

// ---------------------------------------------------------------------------
// Схемы

const markSchema: z.ZodType<RichMark> = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('bold') }),
  z.strictObject({ type: z.literal('italic') }),
  z.strictObject({ type: z.literal('underline') }),
  z.strictObject({ type: z.literal('strike') }),
  z.strictObject({
    type: z.literal('link'),
    attrs: z.strictObject({
      href: z.string().refine(isSafeLinkHref, 'unsafe_url'),
      target: z.literal('_blank').nullish(),
      rel: z.string().max(64).nullish(),
      class: z.null().optional(),
    }),
  }),
  z.strictObject({
    type: z.literal('tone'),
    attrs: z.strictObject({ tone: z.enum(TEXT_TONES) }),
  }),
  z.strictObject({
    type: z.literal('size'),
    attrs: z.strictObject({ size: z.enum(TEXT_SIZES) }),
  }),
])

const textSchema: z.ZodType<RichText> = z.strictObject({
  type: z.literal('text'),
  text: z.string().min(1),
  marks: z
    .array(markSchema)
    .max(8)
    .refine(
      (marks) => new Set(marks.map((mark) => mark.type)).size === marks.length,
      'duplicate_mark',
    )
    .optional(),
})

const inlineSchema: z.ZodType<RichInline> = z.union([
  textSchema,
  z.strictObject({ type: z.literal('hardBreak') }),
])

const alignShape = { textAlign: z.enum(TEXT_ALIGNS).nullish() }

const paragraphSchema: z.ZodType<RichParagraph> = z.strictObject({
  type: z.literal('paragraph'),
  attrs: z.strictObject(alignShape).optional(),
  content: z.array(inlineSchema).optional(),
})

const headingSchema: z.ZodType<RichHeading> = z.strictObject({
  type: z.literal('heading'),
  attrs: z.strictObject({
    ...alignShape,
    level: z.union([z.literal(2), z.literal(3)]),
  }),
  content: z.array(inlineSchema).optional(),
})

const listItemSchema: z.ZodType<RichListItem> = z.lazy(() =>
  z.strictObject({
    type: z.literal('listItem'),
    content: z
      .array(z.union([paragraphSchema, bulletListSchema, orderedListSchema]))
      .min(1),
  }),
)

const bulletListSchema: z.ZodType<RichBulletList> = z.lazy(() =>
  z.strictObject({
    type: z.literal('bulletList'),
    content: z.array(listItemSchema).min(1),
  }),
)

const orderedListSchema: z.ZodType<RichOrderedList> = z.lazy(() =>
  z.strictObject({
    type: z.literal('orderedList'),
    attrs: z
      .strictObject({
        start: z.number().int().min(1).max(100_000).optional(),
        type: z.null().optional(),
      })
      .optional(),
    content: z.array(listItemSchema).min(1),
  }),
)

const cellSchema: z.ZodType<RichCell> = z.strictObject({
  type: z.enum(['tableCell', 'tableHeader']),
  attrs: z
    .strictObject({
      colspan: z.number().int().min(1).max(RICH_TEXT_LIMITS.tableColumns),
      rowspan: z.number().int().min(1).max(RICH_TEXT_LIMITS.tableRows),
      colwidth: z.array(z.number().int().min(1).max(2000)).max(10).nullable(),
    })
    .partial()
    .optional(),
  // Ячейка — только абзацы: вложенные таблицы и медиа не допускаются.
  content: z.array(paragraphSchema).min(1),
})

const tableSchema: z.ZodType<RichTable> = z.strictObject({
  type: z.literal('table'),
  content: z
    .array(
      z.strictObject({
        type: z.literal('tableRow'),
        content: z.array(cellSchema).min(1).max(RICH_TEXT_LIMITS.tableColumns),
      }),
    )
    .min(1)
    .max(RICH_TEXT_LIMITS.tableRows),
})

const imageSchema: z.ZodType<RichImage> = z.strictObject({
  type: z.literal('image'),
  attrs: z.strictObject({
    src: z.string().refine(isSafeImageSrc, 'unsafe_url'),
    alt: z.string().max(RICH_TEXT_LIMITS.altText).nullish(),
    title: z.string().max(RICH_TEXT_LIMITS.altText).nullish(),
    width: z.null().optional(),
    height: z.null().optional(),
  }),
})

const videoSchema: z.ZodType<RichVideo> = z
  .strictObject({
    type: z.literal('video'),
    attrs: z.strictObject({
      provider: z.enum(VIDEO_PROVIDERS),
      videoId: z.string().max(64),
    }),
  })
  .refine(
    (node) => isValidVideoId(node.attrs.provider, node.attrs.videoId),
    'invalid_video',
  )

const blockSchema: z.ZodType<RichBlock> = z.lazy(() =>
  z.union([
    paragraphSchema,
    headingSchema,
    z.strictObject({
      type: z.literal('blockquote'),
      content: z.array(blockSchema).min(1),
    }),
    bulletListSchema,
    orderedListSchema,
    z.strictObject({ type: z.literal('horizontalRule') }),
    tableSchema,
    imageSchema,
    videoSchema,
  ]),
)

type AnyNode = {
  type: string
  text?: string | undefined
  content?: AnyNode[] | undefined
}

/** Обход документа в глубину: узел, глубина и вложенность списков. */
function walk(
  node: AnyNode,
  visit: (node: AnyNode, depth: number, listDepth: number) => void,
  depth = 0,
  listDepth = 0,
) {
  const isList = node.type === 'bulletList' || node.type === 'orderedList'
  const nextListDepth = isList ? listDepth + 1 : listDepth
  visit(node, depth, nextListDepth)
  for (const child of node.content ?? []) {
    walk(child, visit, depth + 1, nextListDepth)
  }
}

/** Видимый текст документа: блоки — с новой строки (поиск PUB-09). */
export function extractText(doc: RichDocument): string {
  const parts: string[] = []
  const visit = (node: AnyNode) => {
    if (node.type === 'text') {
      parts.push(node.text ?? '')
      return
    }
    if (node.type === 'hardBreak') {
      parts.push('\n')
      return
    }
    for (const child of node.content ?? []) {
      visit(child)
    }
    if (node.type === 'paragraph' || node.type === 'heading') {
      parts.push('\n')
    } else if (node.type === 'tableCell' || node.type === 'tableHeader') {
      parts.push(' ')
    }
  }
  visit(doc)
  return parts
    .join('')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
}

/**
 * Содержимое осмысленно (PUB-03): есть текст, изображение, видео или
 * таблица. Документ только с горизонтальной линией считается пустым.
 */
export function hasMeaningfulContent(doc: RichDocument) {
  let found = false
  walk(doc, (node) => {
    if (
      node.type === 'image' ||
      node.type === 'video' ||
      node.type === 'table' ||
      (node.type === 'text' && (node.text ?? '').trim() !== '')
    ) {
      found = true
    }
  })
  return found
}

/** Пустой документ редактора. */
export const EMPTY_DOCUMENT: RichDocument = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
}

/**
 * Предварительная проверка без рекурсии: глубина вложенности `content` и
 * число узлов ограничиваются до разбора структуры, поэтому очень глубокий
 * документ не переполняет стек ни здесь, ни в рекурсивной схеме.
 */
function checkRawShape(value: unknown): string | null {
  const stack: { node: unknown; depth: number }[] = [{ node: value, depth: 0 }]
  let nodes = 0
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!
    nodes += 1
    if (depth > RICH_TEXT_LIMITS.depth || nodes > RICH_TEXT_LIMITS.nodes) {
      return 'too_deep'
    }
    const content =
      node && typeof node === 'object' && 'content' in node
        ? (node as { content: unknown }).content
        : null
    if (Array.isArray(content)) {
      for (const child of content) {
        stack.push({ node: child, depth: depth + 1 })
      }
    }
  }
  try {
    return JSON.stringify(value).length > RICH_TEXT_LIMITS.jsonChars
      ? 'too_large'
      : null
  } catch {
    return 'too_large'
  }
}

const documentStructureSchema: z.ZodType<RichDocument> = z
  .strictObject({
    type: z.literal('doc'),
    content: z.array(blockSchema).min(1),
  })
  .superRefine((doc, ctx) => {
    let media = 0
    let textChars = 0
    let tooDeep = false
    walk(doc, (node, _depth, listDepth) => {
      if (node.type === 'image' || node.type === 'video') {
        media += 1
      }
      if (node.type === 'text') {
        textChars += node.text?.length ?? 0
      }
      if (listDepth > RICH_TEXT_LIMITS.listDepth) {
        tooDeep = true
      }
    })
    if (media > RICH_TEXT_LIMITS.media) {
      ctx.addIssue({ code: 'custom', message: 'too_many_media' })
    }
    if (textChars > RICH_TEXT_LIMITS.textChars) {
      ctx.addIssue({ code: 'custom', message: 'too_long' })
    }
    if (tooDeep) {
      ctx.addIssue({ code: 'custom', message: 'too_deep' })
    }
  })

/**
 * Документ целиком: сначала размер и глубина без рекурсии, затем структура
 * по белому списку и лимиты текста, медиа и вложенности списков.
 */
export const richDocumentSchema = z
  .unknown()
  .superRefine((value, ctx) => {
    const problem = checkRawShape(value)
    if (problem) {
      ctx.addIssue({ code: 'custom', message: problem, abort: true })
    }
  })
  .pipe(documentStructureSchema)

/** Проверка без исключений — для показа на клиенте (второй слой). */
export function safeParseDocument(value: unknown): RichDocument | null {
  const result = richDocumentSchema.safeParse(value)
  return result.success ? result.data : null
}
