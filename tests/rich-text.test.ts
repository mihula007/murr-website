import { describe, expect, it } from 'vitest'
import {
  extractText,
  hasMeaningfulContent,
  parseVideoUrl,
  RICH_TEXT_LIMITS,
  richDocumentSchema,
  safeParseDocument,
  videoEmbedUrl,
  type RichDocument,
} from '@contracts/rich-text'

const doc = (...content: unknown[]) => ({ type: 'doc', content })
const p = (...content: unknown[]) => ({ type: 'paragraph', content })
const text = (value: string, marks?: unknown[]) =>
  marks ? { type: 'text', text: value, marks } : { type: 'text', text: value }
const link = (href: string) =>
  doc(p(text('ссылка', [{ type: 'link', attrs: { href } }])))
const image = (src: string) => doc({ type: 'image', attrs: { src } })

const isValid = (value: unknown) => richDocumentSchema.safeParse(value).success
const expectValid = (value: unknown) => expect(isValid(value)).toBe(true)
const rejects = (value: unknown) => expect(isValid(value)).toBe(false)

/** Документ, который выдаёт Tiptap со всеми включёнными расширениями. */
const full: RichDocument = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { textAlign: null, level: 2 },
      content: [{ type: 'text', text: 'Заголовок' }],
    },
    {
      type: 'paragraph',
      attrs: { textAlign: 'center' },
      content: [
        {
          type: 'text',
          text: 'Жирный',
          marks: [
            { type: 'bold' },
            { type: 'tone', attrs: { tone: 'gold' } },
            { type: 'size', attrs: { size: 'lg' } },
          ],
        },
        { type: 'hardBreak' },
        {
          type: 'text',
          text: 'сайт',
          marks: [
            {
              type: 'link',
              attrs: {
                href: 'https://example.com',
                target: '_blank',
                rel: 'noopener noreferrer nofollow',
                class: null,
              },
            },
          ],
        },
      ],
    },
    {
      type: 'blockquote',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ц' }] }],
    },
    {
      type: 'orderedList',
      attrs: { start: 1, type: null },
      content: [
        {
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Один' }] },
            {
              type: 'bulletList',
              content: [
                {
                  type: 'listItem',
                  content: [{ type: 'paragraph' }],
                },
              ],
            },
          ],
        },
      ],
    },
    { type: 'horizontalRule' },
    {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableHeader',
              attrs: { colspan: 1, rowspan: 1, colwidth: null },
              content: [{ type: 'paragraph' }],
            },
          ],
        },
      ],
    },
    {
      type: 'image',
      attrs: {
        src: 'https://example.com/a.png',
        alt: null,
        title: null,
        width: null,
        height: null,
      },
    },
    { type: 'video', attrs: { provider: 'youtube', videoId: 'dQw4w9WgXcQ' } },
    { type: 'video', attrs: { provider: 'vk', videoId: '-12345_456239017' } },
  ],
}

describe('richDocumentSchema', () => {
  it('принимает документ со всеми разрешёнными узлами и метками', () => {
    expect(isValid(full)).toBe(true)
  })

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'java\tscript:alert(1)',
    'javascript&#58;alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    '//evil.example/x',
    '/relative',
  ])('отклоняет опасную ссылку %s', (href) => {
    rejects(link(href))
  })

  it('принимает http, https и mailto в ссылках', () => {
    expect(isValid(link('http://example.com'))).toBe(true)
    expect(isValid(link('https://example.com/путь?q=1'))).toBe(true)
    expect(isValid(link('mailto:clan@example.com'))).toBe(true)
  })

  it.each([
    'http://example.com/a.png',
    'javascript:alert(1)',
    'data:image/svg+xml,<svg onload=alert(1)>',
    'blob:https://example.com/x',
  ])('отклоняет изображение %s', (src) => {
    rejects(image(src))
  })

  it('отклоняет неизвестные узлы, метки и атрибуты', () => {
    rejects(doc({ type: 'iframe', attrs: { src: 'https://evil.example' } }))
    rejects(doc({ type: 'codeBlock', content: [text('x')] }))
    rejects(doc({ type: 'html', content: '<script>alert(1)</script>' }))
    rejects(doc(p(text('x', [{ type: 'code' }]))))
    rejects(doc(p(text('x', [{ type: 'textStyle', attrs: { color: 'red' } }]))))
    rejects(
      doc({ type: 'paragraph', attrs: { style: 'color:red' }, content: [] }),
    )
    rejects(doc({ type: 'paragraph', attrs: { class: 'x' } }))
    rejects(
      doc({
        type: 'image',
        attrs: { src: 'https://example.com/a.png', onerror: 'alert(1)' },
      }),
    )
    rejects(
      doc(
        p(
          text('x', [
            {
              type: 'link',
              attrs: { href: 'https://e.example', onclick: 'alert(1)' },
            },
          ]),
        ),
      ),
    )
    rejects(
      doc(
        p(
          text('x', [
            {
              type: 'link',
              attrs: { href: 'https://e.example', class: 'evil' },
            },
          ]),
        ),
      ),
    )
    rejects(doc(p(text('x', [{ type: 'tone', attrs: { tone: 'red' } }]))))
    rejects(doc(p(text('x', [{ type: 'size', attrs: { size: '99px' } }]))))
    rejects(doc({ type: 'heading', attrs: { level: 1 }, content: [] }))
    rejects(doc(p(text('x', [{ type: 'bold' }, { type: 'bold' }]))))
    rejects({ type: 'doc', content: [] })
    rejects('<p>html</p>')
  })

  it('отклоняет видео с чужим провайдером или испорченным идентификатором', () => {
    rejects(doc({ type: 'video', attrs: { provider: 'rutube', videoId: 'x' } }))
    rejects(
      doc({
        type: 'video',
        attrs: { provider: 'youtube', videoId: '"><script>' },
      }),
    )
    rejects(
      doc({
        type: 'video',
        attrs: { provider: 'vk', videoId: '1_2&hash=1' },
      }),
    )
    rejects(
      doc({
        type: 'video',
        attrs: {
          provider: 'youtube',
          videoId: 'dQw4w9WgXcQ',
          src: 'https://evil.example',
        },
      }),
    )
  })

  it('отклоняет вложенные таблицы и медиа в ячейке', () => {
    const cell = (content: unknown[]) => ({
      type: 'table',
      content: [
        { type: 'tableRow', content: [{ type: 'tableCell', content }] },
      ],
    })
    rejects(doc(cell([cell([p()])])))
    rejects(
      doc(cell([{ type: 'image', attrs: { src: 'https://e.example/a.png' } }])),
    )
  })

  it('ограничивает размер таблицы', () => {
    const row = (cells: number) => ({
      type: 'tableRow',
      content: Array.from({ length: cells }, () => ({
        type: 'tableCell',
        content: [p()],
      })),
    })
    const table = (rows: number, cells: number) =>
      doc({
        type: 'table',
        content: Array.from({ length: rows }, () => row(cells)),
      })
    expectValid(
      table(RICH_TEXT_LIMITS.tableRows, RICH_TEXT_LIMITS.tableColumns),
    )
    rejects(table(RICH_TEXT_LIMITS.tableRows + 1, 1))
    rejects(table(1, RICH_TEXT_LIMITS.tableColumns + 1))
  })

  it('ограничивает число медиа, длину текста и размер JSON', () => {
    const images = (count: number) =>
      doc(
        ...Array.from({ length: count }, () => ({
          type: 'image',
          attrs: { src: 'https://example.com/a.png' },
        })),
      )
    expectValid(images(RICH_TEXT_LIMITS.media))
    rejects(images(RICH_TEXT_LIMITS.media + 1))
    rejects(doc(p(text('я'.repeat(RICH_TEXT_LIMITS.textChars + 1)))))
    rejects(
      doc(
        ...Array.from({ length: 2000 }, () =>
          p(
            text('x', [
              {
                type: 'link',
                attrs: { href: 'https://example.com/long/path' },
              },
            ]),
          ),
        ),
      ),
    )
  })

  it('ограничивает вложенность списков и глубину без переполнения стека', () => {
    const nested = (levels: number): unknown =>
      levels === 0
        ? p(text('x'))
        : {
            type: 'bulletList',
            content: [{ type: 'listItem', content: [p(), nested(levels - 1)] }],
          }
    expectValid(doc(nested(RICH_TEXT_LIMITS.listDepth)))
    rejects(doc(nested(RICH_TEXT_LIMITS.listDepth + 1)))

    let deep: unknown = p(text('x'))
    for (let index = 0; index < 100_000; index += 1) {
      deep = { type: 'blockquote', content: [deep] }
    }
    expect(() => richDocumentSchema.safeParse(doc(deep))).not.toThrow()
    rejects(doc(deep))
  })

  it('safeParseDocument возвращает null вместо исключения', () => {
    expect(safeParseDocument({ type: 'doc', content: [{ type: 'x' }] })).toBe(
      null,
    )
    expect(safeParseDocument(full)).toEqual(full)
  })
})

describe('extractText и hasMeaningfulContent', () => {
  it('собирает текст блоков и ячеек для поиска', () => {
    expect(extractText(full)).toBe('Заголовок\nЖирный\nсайт\nЦ\nОдин')
  })

  it('пустым считается документ без текста и медиа, в том числе только с линией', () => {
    expect(hasMeaningfulContent(doc(p()) as RichDocument)).toBe(false)
    expect(hasMeaningfulContent(doc(p(text('   '))) as RichDocument)).toBe(
      false,
    )
    expect(
      hasMeaningfulContent(doc({ type: 'horizontalRule' }) as RichDocument),
    ).toBe(false)
    expect(hasMeaningfulContent(doc(p(text('Текст'))) as RichDocument)).toBe(
      true,
    )
    expect(
      hasMeaningfulContent(image('https://example.com/a.png') as RichDocument),
    ).toBe(true)
  })
})

describe('parseVideoUrl и videoEmbedUrl', () => {
  it.each([
    [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10',
      'youtube',
      'dQw4w9WgXcQ',
    ],
    ['https://youtu.be/dQw4w9WgXcQ?si=abc', 'youtube', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/shorts/dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ'],
    ['https://vk.com/video-12345_456239017', 'vk', '-12345_456239017'],
    ['https://vkvideo.ru/video-12345_456239017', 'vk', '-12345_456239017'],
    [
      'https://vk.com/videos-1?z=video-12345_456239017',
      'vk',
      '-12345_456239017',
    ],
    [
      'https://vk.com/video_ext.php?oid=-12345&id=456239017&hash=a',
      'vk',
      '-12345_456239017',
    ],
  ])('распознаёт %s', (url, provider, videoId) => {
    expect(parseVideoUrl(url)).toEqual({ provider, videoId })
  })

  it.each([
    'https://rutube.ru/video/abc/',
    'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v=short',
    'javascript:alert(1)',
    'не ссылка',
  ])('не распознаёт %s', (url) => {
    expect(parseVideoUrl(url)).toBe(null)
  })

  it('строит адрес плеера только из проверенного идентификатора', () => {
    expect(videoEmbedUrl('youtube', 'dQw4w9WgXcQ')).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    )
    expect(videoEmbedUrl('vk', '-12345_456239017')).toBe(
      'https://vk.com/video_ext.php?oid=-12345&id=456239017',
    )
    expect(videoEmbedUrl('youtube', '"><script>')).toBe(null)
  })
})
