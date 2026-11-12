import { useEffect } from 'react'
import type { JSONContent } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import type { RichDocument } from '@contracts/rich-text'
import { cn } from '@/lib/utils'
import { EditorToolbar } from './editor-toolbar'
import { editorExtensions } from './extensions'
import { EDITOR_AREA_CLASS } from './rich-text-classes'

export type RichTextEditorProps = {
  id: string
  value: RichDocument
  onChange: (value: RichDocument) => void
  onBlur?: () => void
  label: string
  invalid?: boolean
  describedBy?: string
}

/**
 * Общий редактор публикаций и объявлений (Q-57). Значение — JSON Tiptap;
 * проверку схемой выполняет форма и сервер. Модуль загружается лениво.
 */
export default function RichTextEditor({
  id,
  value,
  onChange,
  onBlur,
  label,
  invalid,
  describedBy,
}: RichTextEditorProps) {
  const editor = useEditor({
    extensions: editorExtensions(),
    content: value as JSONContent,
    injectCSS: false,
    immediatelyRender: true,
    editorProps: {
      attributes: {
        id,
        class: EDITOR_AREA_CLASS,
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': label,
        ...(invalid ? { 'aria-invalid': 'true' } : {}),
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
      },
    },
    onUpdate: ({ editor: current }) =>
      onChange(current.getJSON() as RichDocument),
    onBlur: () => onBlur?.(),
  })

  // Значение снаружи (сброс формы, загрузка черновика) заменяет документ.
  useEffect(() => {
    if (
      editor &&
      !editor.isDestroyed &&
      JSON.stringify(editor.getJSON()) !== JSON.stringify(value)
    ) {
      editor.commands.setContent(value as JSONContent, {
        emitUpdate: false,
      })
    }
  }, [editor, value])

  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border bg-input-background focus-within:border-primary',
        invalid ? 'border-destructive' : 'border-input',
      )}
    >
      <EditorToolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  )
}
