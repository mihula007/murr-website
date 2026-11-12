import { lazy, Suspense } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import type { RichTextEditorProps } from './rich-text-editor'

const RichTextEditor = lazy(() => import('./rich-text-editor'))

/** Редактор подгружается только на экране правки (Tiptap — отдельный чанк). */
export function LazyRichTextEditor(props: RichTextEditorProps) {
  return (
    <Suspense
      fallback={
        <Skeleton
          className="h-80 w-full rounded-lg"
          aria-label="Загрузка редактора"
        />
      }
    >
      <RichTextEditor {...props} />
    </Suspense>
  )
}
