import { useRef, useState } from 'react'
import { ImagePlus, Trash2 } from 'lucide-react'
import { PUBLICATION_FILE_LIMITS } from '@contracts/publications'
import { Button } from '@/components/ui/button'
import { errorMessage, type AppError } from '@/lib/errors'
import { uploadPublicationImage } from './materials-api'
import { ImageFileError, prepareImage } from './compress-image'

export type DraftAttachment = {
  path: string
  fileName: string
  /** Подписанная ссылка или локальный предпросмотр. */
  url: string | null
}

/**
 * Вложения публикации (PUB-13): JPEG, PNG, WebP до 1 МБ, не больше 10;
 * список с удалением до сохранения. Новые пути сообщаются наверх, чтобы
 * отменённый редактор удалил их (PUB-16).
 */
export function AttachmentsField({
  id,
  value,
  onChange,
  onUploaded,
}: {
  id: string
  value: DraftAttachment[]
  onChange: (value: DraftAttachment[]) => void
  onUploaded: (path: string) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const left = PUBLICATION_FILE_LIMITS.attachments - value.length

  async function add(files: FileList | null) {
    if (!files || files.length === 0) {
      return
    }
    setError(null)
    const chosen = [...files]
    if (chosen.length > left) {
      setError(
        `Можно добавить ещё ${left} из ${PUBLICATION_FILE_LIMITS.attachments}`,
      )
      return
    }
    setBusy(true)
    let next = value
    try {
      for (const file of chosen) {
        const blob = await prepareImage(file)
        const path = await uploadPublicationImage(blob)
        onUploaded(path)
        next = [
          ...next,
          { path, fileName: file.name, url: URL.createObjectURL(blob) },
        ]
        onChange(next)
      }
    } catch (thrown) {
      setError(
        thrown instanceof ImageFileError
          ? thrown.message
          : errorMessage((thrown as AppError).code ?? 'unknown'),
      )
    } finally {
      setBusy(false)
      if (input.current) {
        input.current.value = ''
      }
    }
  }

  return (
    <div className="grid gap-2">
      {value.length > 0 ? (
        <ul
          aria-label="Вложения"
          className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2"
        >
          {value.map((file) => (
            <li
              key={file.path}
              className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-surface-inset p-2"
            >
              {file.url ? (
                <img
                  src={file.url}
                  alt=""
                  className="size-14 shrink-0 rounded-md object-cover"
                />
              ) : null}
              <span className="min-w-0 flex-1 truncate text-sm">
                {file.fileName}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-9 shrink-0"
                aria-label={`Удалить вложение ${file.fileName}`}
                onClick={() =>
                  onChange(value.filter((item) => item.path !== file.path))
                }
              >
                <Trash2 aria-hidden className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <input
        ref={input}
        id={id}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="sr-only"
        onChange={(event) => void add(event.target.files)}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          disabled={busy || left <= 0}
          onClick={() => input.current?.click()}
        >
          <ImagePlus aria-hidden className="size-4" />
          {busy ? 'Загружаем…' : 'Добавить изображения'}
        </Button>
        <span className="text-xs text-muted-foreground">
          JPEG, PNG или WebP до 1 МБ, не больше{' '}
          {PUBLICATION_FILE_LIMITS.attachments}.
        </span>
      </div>
      {error ? (
        <p role="alert" className="m-0 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
