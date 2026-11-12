import { Editor, type JSONContent } from '@tiptap/core'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { richDocumentSchema, type RichDocument } from '@contracts/rich-text'
import { editorExtensions } from '@/features/content/extensions'
import { RichText } from '@/features/content/rich-text'

let editor: Editor | null = null
afterEach(() => {
  editor?.destroy()
  editor = null
})

function createEditor(content: string | RichDocument = '<p></p>') {
  editor = new Editor({
    extensions: editorExtensions(),
    content: content as string | JSONContent,
    injectCSS: false,
  })
  return editor
}

const issues = (value: unknown) => {
  const result = richDocumentSchema.safeParse(value)
  return result.success ? [] : result.error.issues
}

describe('editor output matches the server schema (Q-57)', () => {
  it('produces an accepted document with every toolbar feature', () => {
    const current = createEditor()
    current
      .chain()
      .insertContent('Заголовок')
      .setHeading({ level: 2 })
      .setAlign('center')
      .run()
    current.chain().focus('end').splitBlock().setParagraph().run()
    current
      .chain()
      .insertContent('Текст')
      .selectParentNode()
      .toggleBold()
      .toggleItalic()
      .toggleUnderline()
      .toggleStrike()
      .setTone('gold')
      .setSize('lg')
      .run()
    current
      .chain()
      .focus('end')
      .insertContent({
        type: 'text',
        text: 'ссылка',
        marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
      })
      .run()
    current
      .chain()
      .focus('end')
      .splitBlock()
      .toggleBulletList()
      .insertContent('один')
      .run()
    current
      .chain()
      .focus('end')
      .splitListItem('listItem')
      .insertContent('два')
      .sinkListItem('listItem')
      .run()
    current
      .chain()
      .focus('end')
      .liftListItem('listItem')
      .liftListItem('listItem')
      .run()
    current
      .chain()
      .focus('end')
      .toggleOrderedList()
      .insertContent('пункт')
      .run()
    current.chain().focus('end').liftListItem('listItem').run()
    current
      .chain()
      .focus('end')
      .toggleBlockquote()
      .insertContent('цитата')
      .run()
    current.chain().focus('end').setHorizontalRule().run()
    current
      .chain()
      .focus('end')
      .insertTable({ rows: 2, cols: 2, withHeaderRow: true })
      .run()
    current
      .chain()
      .focus('end')
      .setImage({ src: 'https://example.com/a.png', alt: 'карта' })
      .run()
    current
      .chain()
      .focus('end')
      .setVideo({ provider: 'youtube', videoId: 'dQw4w9WgXcQ' })
      .run()
    current
      .chain()
      .focus('end')
      .setVideo({ provider: 'vk', videoId: '-1_2' })
      .run()
    current.chain().focus('end').insertContent('конец<br>строка').run()

    const json = current.getJSON()
    expect(issues(json)).toEqual([])
    const types = JSON.stringify(json)
    for (const type of [
      'heading',
      'bulletList',
      'orderedList',
      'blockquote',
      'horizontalRule',
      'table',
      'tableHeader',
      'image',
      'video',
      'tone',
      'size',
      'link',
      'textAlign',
    ]) {
      expect(types).toContain(type)
    }
  })

  it('drops unsafe pasted HTML instead of keeping it', () => {
    const current = createEditor(
      `<p style="color:red" onclick="alert(1)">Текст <a href="javascript:alert(1)">плохая</a>
       <a href="https://ok.example">хорошая</a></p>
       <script>alert(1)</script>
       <iframe src="https://evil.example"></iframe>
       <img src="http://insecure.example/a.png">
       <img src="data:image/png;base64,AAAA">
       <img src="https://ok.example/b.png" onerror="alert(1)">
       <pre><code>код</code></pre>
       <h1>Первый уровень</h1>`,
    )
    const json = current.getJSON()
    expect(issues(json)).toEqual([])
    const text = JSON.stringify(json)
    expect(text).not.toMatch(
      /javascript:|onclick|onerror|<script|iframe|insecure|data:image|style/,
    )
    expect(text).toContain('https://ok.example')
    expect(text).toContain('https://ok.example/b.png')
  })
})

const xssDocument = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'клик',
          marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
        },
      ],
    },
  ],
}

describe('RichText renderer (PUB-04, PUB-12)', () => {
  it('renders the document with the shared classes and safe links', () => {
    const { container } = render(
      <RichText
        content={{
          type: 'doc',
          content: [
            {
              type: 'heading',
              attrs: { level: 2, textAlign: 'center' },
              content: [{ type: 'text', text: 'Правила' }],
            },
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'сайт',
                  marks: [
                    { type: 'link', attrs: { href: 'https://example.com' } },
                    { type: 'tone', attrs: { tone: 'gold' } },
                  ],
                },
              ],
            },
            {
              type: 'video',
              attrs: { provider: 'youtube', videoId: 'dQw4w9WgXcQ' },
            },
          ],
        }}
      />,
    )
    expect(
      screen.getByRole('heading', { level: 2, name: 'Правила' }),
    ).toHaveClass('text-center')
    const link = screen.getByRole('link', { name: 'сайт' })
    expect(link).toHaveAttribute('href', 'https://example.com')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow')
    expect(container.querySelector('.text-primary')).not.toBeNull()
    const frame = screen.getByTitle('Видео YouTube')
    expect(frame).toHaveAttribute(
      'src',
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    )
    expect(frame.getAttribute('sandbox')).not.toContain('allow-top-navigation')
    expect(container.querySelector('[style]')).toBeNull()
  })

  it('refuses a document that fails the schema instead of rendering it', () => {
    const { container } = render(<RichText content={xssDocument} />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(container.textContent).toContain('повреждено')
    render(<RichText content="<img src=x onerror=alert(1)>" />)
    expect(document.querySelector('img')).toBeNull()
  })

  it('groups consecutive images into one gallery with a counter', () => {
    render(
      <RichText
        content={{
          type: 'doc',
          content: [
            {
              type: 'image',
              attrs: { src: 'https://e.example/1.png', alt: 'один' },
            },
            {
              type: 'image',
              attrs: { src: 'https://e.example/2.png', alt: 'два' },
            },
          ],
        }}
      />,
    )
    expect(screen.getAllByRole('figure')).toHaveLength(1)
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
  })
})
