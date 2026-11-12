import { useRef, useState } from 'react'
import { useForm, useStore } from '@tanstack/react-form'
import { Send, Smile, X } from 'lucide-react'
import { z } from 'zod'
import {
  DISCUSSION_LIMITS,
  type DiscussionMessage,
  type ThreadRef,
} from '@contracts/discussions'
import { fieldAria, fieldError } from '@/components/form/form-field'
import { focusFirstInvalid } from '@/components/form/focus-first-invalid'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Textarea } from '@/components/ui/input'
import { toast } from '@/components/ui/toaster'
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard'
import { errorMessage, type AppError } from '@/lib/errors'
import { useSendMessage } from './api'
import { isSubmitShortcut } from './message'

/** Эмодзи для вставки в текст (DSC-06); набор шире реакций. */
export const INSERT_EMOJI = [
  '😀',
  '😁',
  '😂',
  '🤣',
  '😊',
  '😍',
  '😎',
  '🤔',
  '😅',
  '😉',
  '😢',
  '😭',
  '😡',
  '🤡',
  '👍',
  '👎',
  '👌',
  '🙏',
  '💪',
  '🔥',
  '❤️',
  '🎉',
  '⚔️',
  '🛡️',
] as const

const sendSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'required')
    .max(DISCUSSION_LIMITS.body, 'too_long'),
})

/** Вставка в позицию курсора; без выделения — в конец. */
export function insertAt(
  value: string,
  insert: string,
  start: number | null,
  end: number | null,
) {
  const from = start ?? value.length
  const to = end ?? from
  return {
    value: value.slice(0, from) + insert + value.slice(to),
    caret: from + insert.length,
  }
}

type ComposerProps = {
  thread: ThreadRef
  replyTo: DiscussionMessage | null
  onCancelReply: () => void
  onSent: () => void
}

/**
 * Поле нового сообщения (DSC-03, DSC-05, DSC-06): кнопка или Ctrl/Cmd+Enter,
 * Enter — перенос строки; ответ с цитатой и отменой; эмодзи в курсор.
 */
export function Composer({
  thread,
  replyTo,
  onCancelReply,
  onSent,
}: ComposerProps) {
  const send = useSendMessage(thread)
  const [serverError, setServerError] = useState<AppError | null>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const id = `discussion-${thread.parent}-${thread.parentId}`

  const form = useForm({
    defaultValues: { body: '' },
    validators: { onSubmit: sendSchema },
    onSubmitInvalid: focusFirstInvalid,
    onSubmit: async ({ value }) => {
      setServerError(null)
      await send
        .mutateAsync({
          body: sendSchema.parse(value).body,
          replyToId: replyTo?.id ?? null,
        })
        .then(() => {
          form.reset()
          onCancelReply()
          onSent()
        })
        .catch((error: AppError) => {
          if (error.code === 'state_conflict') {
            toast('Обсуждение закрыто: сообщение не отправлено')
          }
          setServerError(error)
        })
    },
  })
  const isDirty = useStore(form.store, (state) => state.isDirty)
  const { dialog } = useUnsavedChangesGuard(isDirty)

  const replyAuthor =
    replyTo?.author.state === 'shown'
      ? replyTo.author.gameNickname
      : 'Пользователь удалён'

  return (
    <form
      noValidate
      className="grid gap-2 border-t border-border pt-3"
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      {replyTo ? (
        <div className="flex min-w-0 items-start gap-2 rounded-lg border-l-2 border-primary bg-surface-inset px-3 py-2 text-xs">
          <div className="grid min-w-0 flex-1 gap-0.5">
            <span className="font-semibold text-foreground">
              Ответ {replyAuthor}
            </span>
            <span className="truncate text-muted-foreground">
              {replyTo.body}
            </span>
          </div>
          <button
            type="button"
            aria-label="Отменить ответ"
            onClick={onCancelReply}
            className="grid size-7 flex-none cursor-pointer place-items-center rounded-md border-0 bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      ) : null}
      <form.Subscribe selector={(state) => state.submissionAttempts > 0}>
        {(submitted) => (
          <form.Field name="body">
            {(field) => {
              const error = fieldError(
                field.state.meta,
                submitted,
                serverError?.fields.body,
              )
              const hint = `${field.state.value.length} / ${DISCUSSION_LIMITS.body}. Ctrl+Enter — отправить`
              return (
                <div className="grid gap-1">
                  <label htmlFor={id} className="sr-only">
                    Сообщение
                  </label>
                  <div className="flex items-end gap-2">
                    <Textarea
                      ref={textarea}
                      {...fieldAria(id, error, hint)}
                      rows={2}
                      maxLength={DISCUSSION_LIMITS.body}
                      placeholder="Напишите сообщение"
                      className="max-h-40 min-h-[46px] resize-y"
                      value={field.state.value}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                      onBlur={field.handleBlur}
                      onKeyDown={(event) => {
                        if (isSubmitShortcut(event)) {
                          event.preventDefault()
                          void form.handleSubmit()
                        }
                      }}
                    />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="Вставить эмодзи"
                          className="flex-none"
                        >
                          <Smile size={20} aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        className="grid min-w-0 grid-cols-6 gap-1"
                        onCloseAutoFocus={(event) => {
                          event.preventDefault()
                          textarea.current?.focus()
                        }}
                      >
                        {INSERT_EMOJI.map((emoji) => (
                          <DropdownMenuItem
                            key={emoji}
                            aria-label={`Вставить ${emoji}`}
                            className="size-10 justify-center p-0 text-xl"
                            onSelect={() => {
                              const element = textarea.current
                              const next = insertAt(
                                field.state.value,
                                emoji,
                                element?.selectionStart ?? null,
                                element?.selectionEnd ?? null,
                              )
                              field.handleChange(next.value)
                              requestAnimationFrame(() =>
                                element?.setSelectionRange(
                                  next.caret,
                                  next.caret,
                                ),
                              )
                            }}
                          >
                            {emoji}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Button
                      type="submit"
                      size="icon"
                      aria-label="Отправить"
                      className="flex-none"
                      disabled={send.isPending}
                    >
                      <Send size={18} aria-hidden="true" />
                    </Button>
                  </div>
                  <p
                    id={`${id}-hint`}
                    className="m-0 text-2xs text-muted-foreground"
                  >
                    {hint}
                  </p>
                  {error ? (
                    <p
                      id={`${id}-error`}
                      className="m-0 text-xs text-destructive"
                    >
                      {error}
                    </p>
                  ) : null}
                  {serverError && !serverError.fields.body ? (
                    <p role="alert" className="m-0 text-xs text-destructive">
                      {serverError.code === 'state_conflict'
                        ? 'Обсуждение закрыто.'
                        : errorMessage(serverError.code)}
                    </p>
                  ) : null}
                </div>
              )
            }}
          </form.Field>
        )}
      </form.Subscribe>
      {dialog}
    </form>
  )
}
