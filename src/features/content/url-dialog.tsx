import { useState, type FormEvent } from 'react'
import type { Editor } from '@tiptap/core'
import {
  isSafeImageSrc,
  isSafeLinkHref,
  parseVideoUrl,
} from '@contracts/rich-text'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/surfaces'

const INPUT_ID = 'url-dialog-input'

export type UrlDialogMode = 'link' | 'image' | 'video'

const TEXTS: Record<
  UrlDialogMode,
  { title: string; description: string; label: string; error: string }
> = {
  link: {
    title: 'Ссылка',
    description: 'Адрес http, https или mailto.',
    label: 'Адрес ссылки',
    error: 'Нужен адрес вида https://… или mailto:…',
  },
  image: {
    title: 'Изображение по ссылке',
    description:
      'Изображение загрузится со стороннего сайта. Нужна прямая ссылка https на картинку.',
    label: 'Адрес изображения',
    error: 'Нужна ссылка https:// на изображение.',
  },
  video: {
    title: 'Видео',
    description: 'Ссылка на ролик YouTube или VK — он встроится плеером.',
    label: 'Ссылка на видео',
    error: 'Это не ссылка на ролик YouTube или VK.',
  },
}

/**
 * Ввод адреса для ссылки, изображения и видео (PUB-11, Q-56). Адрес
 * проверяется теми же правилами, что и на сервере, до вставки в документ.
 */
export function UrlDialog({
  editor,
  mode,
  onClose,
}: {
  editor: Editor
  mode: UrlDialogMode | null
  onClose: () => void
}) {
  const [value, setValue] = useState('')
  const [error, setError] = useState(false)
  const texts = mode ? TEXTS[mode] : null

  const close = () => {
    setValue('')
    setError(false)
    onClose()
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    // Диалог в портале, но событие React всплывает к форме материала.
    event.stopPropagation()
    const url = value.trim()
    const chain = editor.chain().focus()
    if (mode === 'link' && isSafeLinkHref(url)) {
      if (editor.state.selection.empty) {
        chain
          .insertContent({
            type: 'text',
            text: url,
            marks: [{ type: 'link', attrs: { href: url } }],
          })
          .run()
      } else {
        chain.extendMarkRange('link').setLink({ href: url }).run()
      }
      close()
      return
    }
    if (mode === 'image' && isSafeImageSrc(url)) {
      chain.setImage({ src: url }).run()
      close()
      return
    }
    const video = mode === 'video' ? parseVideoUrl(url) : null
    if (video) {
      chain.setVideo(video).run()
      close()
      return
    }
    setError(true)
  }

  return (
    <Dialog open={mode !== null} onOpenChange={(open) => !open && close()}>
      {texts ? (
        <DialogContent>
          <form className="grid gap-4" onSubmit={submit} noValidate>
            <DialogHeader>
              <DialogTitle>{texts.title}</DialogTitle>
              <DialogDescription>{texts.description}</DialogDescription>
            </DialogHeader>
            <Field htmlFor={INPUT_ID}>
              {texts.label}
              <Input
                id={INPUT_ID}
                type="url"
                inputMode="url"
                value={value}
                aria-invalid={error || undefined}
                aria-describedby={error ? 'url-dialog-error' : undefined}
                onChange={(event) => {
                  setValue(event.target.value)
                  setError(false)
                }}
              />
            </Field>
            {error ? (
              <p
                id="url-dialog-error"
                role="alert"
                className="m-0 text-sm text-destructive"
              >
                {texts.error}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={close}>
                Отмена
              </Button>
              <Button type="submit">Вставить</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      ) : null}
    </Dialog>
  )
}
