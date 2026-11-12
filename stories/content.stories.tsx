import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { RichDocument } from '../supabase/functions/_shared/contracts/rich-text'
import { LazyRichTextEditor } from '../src/features/content/lazy-editor'
import { RichText } from '../src/features/content/rich-text'

const meta = { title: 'Материалы/Документ' } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const sample: RichDocument = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Правила распределения добычи' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Добыча делится ' },
        { type: 'text', text: 'поровну', marks: [{ type: 'bold' }] },
        { type: 'text', text: ' между участниками ' },
        {
          type: 'text',
          text: 'рейда',
          marks: [{ type: 'tone', attrs: { tone: 'gold' } }],
        },
        { type: 'text', text: '. Подробнее — ' },
        {
          type: 'text',
          text: 'в гайде',
          marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
        },
        { type: 'text', text: '.' },
      ],
    },
    {
      type: 'bulletList',
      content: ['Лидер распределяет', 'Спорное — на голосование'].map(
        (text) => ({
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
        }),
      ),
    },
    {
      type: 'blockquote',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Клан сильнее одиночки.' }],
        },
      ],
    },
    { type: 'horizontalRule' },
    {
      type: 'table',
      content: [
        ['Класс', 'Доля'],
        ['Танк', '1'],
      ].map((row, index) => ({
        type: 'tableRow',
        content: row.map((text) => ({
          type: index === 0 ? 'tableHeader' : 'tableCell',
          content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
        })),
      })),
    },
  ],
} as RichDocument

export const Rendered: Story = {
  name: 'Показ материала',
  render: () => <RichText className="max-w-2xl" content={sample} />,
}

function EditorDemo() {
  const [value, setValue] = useState<RichDocument>(sample)
  return (
    <div className="grid max-w-3xl gap-6">
      <LazyRichTextEditor
        id="story-editor"
        label="Содержимое"
        value={value}
        onChange={setValue}
      />
      <RichText content={value} />
    </div>
  )
}

export const Editor: Story = {
  name: 'Редактор и предпросмотр',
  render: () => <EditorDemo />,
}
