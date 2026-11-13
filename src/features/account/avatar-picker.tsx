import { useEffect, useMemo } from 'react'
import { ImageUp } from 'lucide-react'
import { fieldAria } from '@/components/form/form-field'
import { Avatar } from '@/components/ui/avatar'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type AvatarPickerProps = {
  id: string
  /** Новый файл (после сжатия) или null. */
  file: Blob | null
  /** Ссылка на текущий аватар профиля, если файл не выбран. */
  currentUrl?: string | null
  /** Имя для первой буквы, пока изображения нет; пустое — «?». */
  name: string
  onSelect: (file: File) => void
  onRemove?: () => void
  busy?: boolean
  error?: string | null | undefined
}

/** Выбор аватара с предпросмотром до сохранения (ACC-08). */
export function AvatarPicker({
  id,
  file,
  currentUrl,
  name,
  onSelect,
  onRemove,
  busy,
  error,
}: AvatarPickerProps) {
  const preview = useMemo(
    () => (file ? URL.createObjectURL(file) : null),
    [file],
  )
  useEffect(
    () => () => {
      if (preview) {
        URL.revokeObjectURL(preview)
      }
    },
    [preview],
  )
  const shown = preview ?? currentUrl ?? null
  const hint = 'JPEG, PNG или WebP до 500 КБ; уменьшается до 512 px'
  return (
    <div className="flex min-w-0 items-center gap-4">
      <Avatar size="md" name={name} src={shown} alt="Предпросмотр аватара" />
      <div className="grid min-w-0 flex-1 gap-2">
        {/* Системная кнопка файла («Choose File») скрыта: её заменяет
            кнопка интерфейса — подпись того же поля, фокус виден на ней. */}
        <input
          {...fieldAria(id, error, hint)}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="peer sr-only"
          disabled={busy}
          onChange={(event) => {
            const selected = event.target.files?.[0]
            if (selected) {
              onSelect(selected)
            }
            event.target.value = ''
          }}
        />
        <label
          htmlFor={id}
          className={cn(
            buttonVariants({ variant: 'secondary', size: 'sm' }),
            'justify-self-start peer-focus-visible:outline-2 peer-focus-visible:outline-offset-3 peer-focus-visible:outline-ring peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
          )}
        >
          <ImageUp aria-hidden="true" size={14} />
          {shown ? 'Заменить фото' : 'Выбрать фото'}
        </label>
        {onRemove && shown ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="justify-self-start"
            onClick={onRemove}
          >
            Убрать фото
          </Button>
        ) : null}
      </div>
    </div>
  )
}
