import { useState, type ReactNode } from 'react'
import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ALargeSmall,
  Bold,
  ChevronDown,
  Film,
  ImagePlus,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link,
  List,
  ListOrdered,
  Minus,
  Omega,
  Palette,
  Pilcrow,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Table,
  Underline,
  Undo2,
  Unlink,
} from 'lucide-react'
import {
  TEXT_SIZE_LABELS,
  TEXT_SIZES,
  TEXT_TONE_LABELS,
  TEXT_TONES,
  type TextAlign,
} from '@contracts/rich-text'
import { buttonVariants } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { SIZE_CLASS, TONE_CLASS } from './rich-text-classes'
import { UrlDialog, type UrlDialogMode } from './url-dialog'

const toolClass = cn(
  buttonVariants({ variant: 'ghost', size: 'icon' }),
  'size-9 rounded-md aria-pressed:bg-accent aria-pressed:text-primary',
)
const iconClass = 'size-4'

function ToolButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className={toolClass}
      title={label}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function ToolMenu({
  label,
  icon,
  children,
}: {
  label: string
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        className={cn(toolClass, 'w-auto gap-0.5 px-1.5')}
        title={label}
        aria-label={label}
      >
        {icon}
        <ChevronDown aria-hidden className="size-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">{children}</DropdownMenuContent>
    </DropdownMenu>
  )
}

const Divider = () => (
  <span aria-hidden className="mx-0.5 h-6 w-px self-center bg-border" />
)

const SPECIAL_CHARACTERS = [
  '—',
  '–',
  '«',
  '»',
  '…',
  '№',
  '°',
  '±',
  '×',
  '÷',
  '≈',
  '≠',
  '←',
  '→',
  '↑',
  '↓',
  '★',
  '☆',
  '♥',
  '✓',
  '✗',
  '©',
  '€',
  '₽',
] as const

const ALIGNS: { value: TextAlign; label: string; icon: ReactNode }[] = [
  {
    value: 'left',
    label: 'По левому краю',
    icon: <AlignLeft aria-hidden className={iconClass} />,
  },
  {
    value: 'center',
    label: 'По центру',
    icon: <AlignCenter aria-hidden className={iconClass} />,
  },
  {
    value: 'right',
    label: 'По правому краю',
    icon: <AlignRight aria-hidden className={iconClass} />,
  },
  {
    value: 'justify',
    label: 'По ширине',
    icon: <AlignJustify aria-hidden className={iconClass} />,
  },
]

/**
 * Панель общего редактора (PUB-10, PUB-11). На узком экране кнопки
 * переносятся на следующие строки — горизонтальной прокрутки нет.
 */
export function EditorToolbar({ editor }: { editor: Editor }) {
  const [dialog, setDialog] = useState<UrlDialogMode | null>(null)
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive('bold'),
      italic: current.isActive('italic'),
      underline: current.isActive('underline'),
      strike: current.isActive('strike'),
      link: current.isActive('link'),
      bulletList: current.isActive('bulletList'),
      orderedList: current.isActive('orderedList'),
      inList: current.isActive('listItem'),
      inTable: current.isActive('table'),
      canUndo: current.can().undo(),
      canRedo: current.can().redo(),
    }),
  })
  const chain = () => editor.chain().focus()

  return (
    <div
      role="toolbar"
      aria-label="Форматирование"
      className="flex flex-wrap items-center gap-0.5 border-b border-border bg-surface-inset p-1"
    >
      <ToolButton
        label="Отменить"
        disabled={!state.canUndo}
        onClick={() => chain().undo().run()}
      >
        <Undo2 aria-hidden className={iconClass} />
      </ToolButton>
      <ToolButton
        label="Повторить"
        disabled={!state.canRedo}
        onClick={() => chain().redo().run()}
      >
        <Redo2 aria-hidden className={iconClass} />
      </ToolButton>
      <Divider />
      <ToolMenu
        label="Тип блока"
        icon={<Pilcrow aria-hidden className={iconClass} />}
      >
        <DropdownMenuItem onSelect={() => chain().setParagraph().run()}>
          Обычный текст
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => chain().setHeading({ level: 2 }).run()}
        >
          Заголовок
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => chain().setHeading({ level: 3 }).run()}
        >
          Подзаголовок
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => chain().toggleBlockquote().run()}>
          Цитата
        </DropdownMenuItem>
      </ToolMenu>
      <ToolButton
        label="Жирный"
        active={state.bold}
        onClick={() => chain().toggleBold().run()}
      >
        <Bold aria-hidden className={iconClass} />
      </ToolButton>
      <ToolButton
        label="Курсив"
        active={state.italic}
        onClick={() => chain().toggleItalic().run()}
      >
        <Italic aria-hidden className={iconClass} />
      </ToolButton>
      <ToolButton
        label="Подчёркнутый"
        active={state.underline}
        onClick={() => chain().toggleUnderline().run()}
      >
        <Underline aria-hidden className={iconClass} />
      </ToolButton>
      <ToolButton
        label="Зачёркнутый"
        active={state.strike}
        onClick={() => chain().toggleStrike().run()}
      >
        <Strikethrough aria-hidden className={iconClass} />
      </ToolButton>
      <ToolMenu
        label="Цвет текста"
        icon={<Palette aria-hidden className={iconClass} />}
      >
        {TEXT_TONES.map((tone) => (
          <DropdownMenuItem
            key={tone}
            onSelect={() => chain().setTone(tone).run()}
          >
            <span className={TONE_CLASS[tone]}>{TEXT_TONE_LABELS[tone]}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => chain().unsetTone().run()}>
          Обычный цвет
        </DropdownMenuItem>
      </ToolMenu>
      <ToolMenu
        label="Размер текста"
        icon={<ALargeSmall aria-hidden className={iconClass} />}
      >
        {TEXT_SIZES.map((size) => (
          <DropdownMenuItem
            key={size}
            onSelect={() => chain().setSize(size).run()}
          >
            <span className={SIZE_CLASS[size]}>{TEXT_SIZE_LABELS[size]}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => chain().unsetSize().run()}>
          Обычный размер
        </DropdownMenuItem>
      </ToolMenu>
      <ToolMenu
        label="Выравнивание"
        icon={<AlignLeft aria-hidden className={iconClass} />}
      >
        {ALIGNS.map((align) => (
          <DropdownMenuItem
            key={align.value}
            onSelect={() => chain().setAlign(align.value).run()}
          >
            {align.icon}
            {align.label}
          </DropdownMenuItem>
        ))}
      </ToolMenu>
      <Divider />
      <ToolButton
        label="Маркированный список"
        active={state.bulletList}
        onClick={() => chain().toggleBulletList().run()}
      >
        <List aria-hidden className={iconClass} />
      </ToolButton>
      <ToolButton
        label="Нумерованный список"
        active={state.orderedList}
        onClick={() => chain().toggleOrderedList().run()}
      >
        <ListOrdered aria-hidden className={iconClass} />
      </ToolButton>
      <ToolButton
        label="Увеличить отступ"
        disabled={!state.inList}
        onClick={() => chain().sinkListItem('listItem').run()}
      >
        <IndentIncrease aria-hidden className={iconClass} />
      </ToolButton>
      <ToolButton
        label="Уменьшить отступ"
        disabled={!state.inList}
        onClick={() => chain().liftListItem('listItem').run()}
      >
        <IndentDecrease aria-hidden className={iconClass} />
      </ToolButton>
      <Divider />
      <ToolButton
        label="Ссылка"
        active={state.link}
        onClick={() => setDialog('link')}
      >
        <Link aria-hidden className={iconClass} />
      </ToolButton>
      {state.link ? (
        <ToolButton
          label="Убрать ссылку"
          onClick={() => chain().unsetLink().run()}
        >
          <Unlink aria-hidden className={iconClass} />
        </ToolButton>
      ) : null}
      <ToolButton
        label="Изображение по ссылке"
        onClick={() => setDialog('image')}
      >
        <ImagePlus aria-hidden className={iconClass} />
      </ToolButton>
      <ToolButton
        label="Видео YouTube или VK"
        onClick={() => setDialog('video')}
      >
        <Film aria-hidden className={iconClass} />
      </ToolButton>
      <ToolMenu
        label="Таблица"
        icon={<Table aria-hidden className={iconClass} />}
      >
        <DropdownMenuItem
          onSelect={() =>
            chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
          }
        >
          Вставить таблицу 3 × 3
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!state.inTable}
          onSelect={() => chain().addRowAfter().run()}
        >
          Добавить строку
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!state.inTable}
          onSelect={() => chain().addColumnAfter().run()}
        >
          Добавить столбец
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!state.inTable}
          onSelect={() => chain().deleteRow().run()}
        >
          Удалить строку
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!state.inTable}
          onSelect={() => chain().deleteColumn().run()}
        >
          Удалить столбец
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!state.inTable}
          onSelect={() => chain().toggleHeaderRow().run()}
        >
          Строка заголовков
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!state.inTable}
          onSelect={() => chain().deleteTable().run()}
        >
          Удалить таблицу
        </DropdownMenuItem>
      </ToolMenu>
      <ToolMenu
        label="Специальные символы"
        icon={<Omega aria-hidden className={iconClass} />}
      >
        <div className="grid grid-cols-6 gap-1 p-1">
          {SPECIAL_CHARACTERS.map((char) => (
            <DropdownMenuItem
              key={char}
              className="justify-center px-0 text-base"
              aria-label={`Вставить «${char}»`}
              onSelect={() => chain().insertContent(char).run()}
            >
              {char}
            </DropdownMenuItem>
          ))}
        </div>
      </ToolMenu>
      <ToolButton
        label="Горизонтальная линия"
        onClick={() => chain().setHorizontalRule().run()}
      >
        <Minus aria-hidden className={iconClass} />
      </ToolButton>
      <ToolButton
        label="Очистить форматирование"
        onClick={() => chain().unsetAllMarks().clearNodes().run()}
      >
        <RemoveFormatting aria-hidden className={iconClass} />
      </ToolButton>
      <UrlDialog
        editor={editor}
        mode={dialog}
        onClose={() => setDialog(null)}
      />
    </div>
  )
}
