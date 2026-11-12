import type { TextAlign, TextSize, TextTone } from '@contracts/rich-text'

/**
 * Оформление документа — одно для редактора и для показа (Q-57). Редактор
 * ставит эти классы через `renderHTML` расширений, рендерер — через
 * отображение узлов, поэтому предпросмотр совпадает с редактированием.
 */
export const RICH = {
  paragraph: 'my-2 leading-relaxed',
  heading: {
    2: 'mt-5 mb-2 text-xl leading-tight font-bold text-highlight',
    3: 'mt-4 mb-2 text-lg leading-tight font-bold',
  },
  blockquote:
    'my-3 border-l-2 border-primary pl-4 text-muted-foreground italic',
  bulletList: 'my-2 list-disc pl-6',
  orderedList: 'my-2 list-decimal pl-6',
  listItem: 'my-1 [&>p]:my-0',
  horizontalRule: 'my-5 border-0 border-t border-border',
  tableWrap: 'my-3 max-w-full overflow-x-auto',
  table: 'w-full border-collapse text-sm',
  cell: 'min-w-16 border border-border px-2 py-1 align-top [&>p]:my-0',
  headerCell:
    'min-w-16 border border-border bg-secondary px-2 py-1 text-left align-top font-bold [&>p]:my-0',
  image: 'my-3 block h-auto max-h-[480px] max-w-full rounded-lg',
  video:
    'my-3 aspect-video w-full overflow-hidden rounded-lg border border-border',
  link: 'text-primary underline underline-offset-2 hover:text-highlight',
  bold: 'font-bold',
  italic: 'italic',
  underline: 'underline underline-offset-2',
  strike: 'line-through',
} as const

export const ALIGN_CLASS: Record<TextAlign, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
  justify: 'text-justify',
}

export const TONE_CLASS: Record<TextTone, string> = {
  gold: 'text-primary',
  highlight: 'text-highlight',
  muted: 'text-muted-foreground',
  danger: 'text-destructive',
  success: 'text-success-foreground',
}

export const SIZE_CLASS: Record<TextSize, string> = {
  sm: 'text-sm',
  lg: 'text-lg',
  xl: 'text-xl',
}

/** Редактируемая область: ProseMirror требует сохранять пробелы. */
export const EDITOR_AREA_CLASS =
  'min-h-64 px-4 py-3 break-words whitespace-pre-wrap text-foreground outline-none [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_.selectedCell]:bg-accent [&_.ProseMirror-selectednode]:outline-2 [&_.ProseMirror-selectednode]:outline-primary'
