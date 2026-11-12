import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useForm, useStore } from '@tanstack/react-form'
import { Check, CheckCheck, Ellipsis } from 'lucide-react'
import { z } from 'zod'
import {
  DISCUSSION_LIMITS,
  REACTIONS,
  type DiscussionMessage,
  type Reaction,
  type ThreadRef,
} from '@contracts/discussions'
import { fieldAria, fieldError } from '@/components/form/form-field'
import { focusFirstInvalid } from '@/components/form/focus-first-invalid'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Textarea } from '@/components/ui/input'
import { toast } from '@/components/ui/toaster'
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard'
import { errorMessage, type AppError } from '@/lib/errors'
import { formatTimeMsk } from '@/lib/format-date'
import { cn } from '@/lib/utils'
import { useEditMessage } from './api'
import { MessageText } from './message-text'

const DELETED = 'Пользователь удалён'

const bodySchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'required')
    .max(DISCUSSION_LIMITS.body, 'too_long'),
})

/** Ctrl+Enter или Cmd+Enter отправляет форму (DSC-03); Enter — перенос. */
export function isSubmitShortcut(event: {
  key: string
  ctrlKey: boolean
  metaKey: boolean
}) {
  return event.key === 'Enter' && (event.ctrlKey || event.metaKey)
}

type Action = {
  key: string
  label: string
  onSelect: () => void
}

type MenuModel = {
  reactions: { emoji: Reaction; mine: boolean }[] | null
  onReact: (emoji: Reaction) => void
  actions: Action[]
}

const reactionItemClass =
  'size-10 justify-center p-0 text-xl data-[mine=true]:bg-secondary data-[mine=true]:inset-ring data-[mine=true]:inset-ring-border-accent'

/** Пункты меню сообщения — одни и те же для правого клика и кнопки «⋯». */
function MenuItems({
  model,
  Item,
  Label,
  Separator,
}: {
  model: MenuModel
  Item: typeof ContextMenuItem | typeof DropdownMenuItem
  Label: typeof ContextMenuLabel | typeof DropdownMenuLabel
  Separator: typeof ContextMenuSeparator | typeof DropdownMenuSeparator
}) {
  return (
    <>
      {model.reactions ? (
        <>
          <Label>Реакция</Label>
          <div className="grid grid-cols-5 gap-1">
            {model.reactions.map(({ emoji, mine }) => (
              <Item
                key={emoji}
                aria-label={
                  mine ? `Снять реакцию ${emoji}` : `Реакция ${emoji}`
                }
                data-mine={mine}
                className={reactionItemClass}
                onSelect={() => model.onReact(emoji)}
              >
                {emoji}
              </Item>
            ))}
          </div>
          {model.actions.length > 0 ? <Separator /> : null}
        </>
      ) : null}
      {model.actions.map((action) => (
        <Item key={action.key} onSelect={action.onSelect}>
          {action.label}
        </Item>
      ))}
    </>
  )
}

/** Правка своего сообщения в строке (DSC-08); «Отмена» оставляет текст. */
function EditForm({
  thread,
  message,
  onDone,
}: {
  thread: ThreadRef
  message: DiscussionMessage
  onDone: () => void
}) {
  const edit = useEditMessage(thread)
  const [serverError, setServerError] = useState<AppError | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    input.current?.focus()
  }, [])
  const form = useForm({
    defaultValues: { body: message.body },
    validators: { onChange: bodySchema },
    onSubmitInvalid: focusFirstInvalid,
    onSubmit: async ({ value }) => {
      setServerError(null)
      await edit
        .mutateAsync({ messageId: message.id, ...bodySchema.parse(value) })
        .then(() => onDone())
        .catch((error: AppError) => {
          if (error.code === 'state_conflict') {
            toast('Время правки истекло или обсуждение закрыто')
            onDone()
            return
          }
          setServerError(error)
        })
    },
  })
  const isDirty = useStore(form.store, (state) => state.isDirty)
  const { dialog } = useUnsavedChangesGuard(isDirty)
  const id = `discussion-edit-${message.id}`

  return (
    <form
      noValidate
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <form.Subscribe selector={(state) => state.submissionAttempts > 0}>
        {(submitted) => (
          <form.Field name="body">
            {(field) => {
              const error = fieldError(
                field.state.meta,
                submitted,
                serverError?.fields.body,
              )
              return (
                <>
                  <label htmlFor={id} className="sr-only">
                    Текст сообщения
                  </label>
                  <Textarea
                    ref={input}
                    {...fieldAria(id, error)}
                    rows={3}
                    maxLength={DISCUSSION_LIMITS.body}
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    onBlur={field.handleBlur}
                    onKeyDown={(event) => {
                      if (isSubmitShortcut(event)) {
                        event.preventDefault()
                        void form.handleSubmit()
                      } else if (event.key === 'Escape') {
                        event.preventDefault()
                        event.stopPropagation()
                        onDone()
                      }
                    }}
                  />
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
                      {errorMessage(serverError.code)}
                    </p>
                  ) : null}
                </>
              )
            }}
          </form.Field>
        )}
      </form.Subscribe>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Отмена
        </Button>
        <Button type="submit" size="sm" disabled={edit.isPending}>
          Сохранить
        </Button>
      </div>
      {dialog}
    </form>
  )
}

type MessageItemProps = {
  thread: ThreadRef
  message: DiscussionMessage
  /** Разделитель дня перед сообщением (DSC-02). */
  dateLabel: string | null
  canWrite: boolean
  /** Своё сообщение ещё можно править (DSC-08). */
  editable: boolean
  /** Своё сообщение прочитано другими (DSC-12). */
  read: boolean
  canSeeReaders: boolean
  editing: boolean
  onEditingChange: (editing: boolean) => void
  onReply: () => void
  onReact: (emoji: Reaction) => void
  onShowPeople: (kind: 'readers' | 'reactions') => void
}

/** Сообщение ветки: автор, время, цитата, текст, реакции и меню. */
export function MessageItem({
  thread,
  message,
  dateLabel,
  canWrite,
  editable,
  read,
  canSeeReaders,
  editing,
  onEditingChange,
  onReply,
  onReact,
  onShowPeople,
}: MessageItemProps) {
  const author =
    message.author.state === 'shown' ? message.author.gameNickname : DELETED
  const mineReactions = new Set(
    message.reactions.filter((r) => r.mine).map((r) => r.emoji),
  )

  const actions: Action[] = []
  if (canWrite) {
    actions.push({ key: 'reply', label: 'Ответить', onSelect: onReply })
  }
  if (message.mine && editable && canWrite) {
    actions.push({
      key: 'edit',
      label: 'Изменить',
      onSelect: () => onEditingChange(true),
    })
  }
  if (canSeeReaders) {
    actions.push({
      key: 'readers',
      label: 'Кто прочитал',
      onSelect: () => onShowPeople('readers'),
    })
  }
  if (message.reactions.length > 0) {
    actions.push({
      key: 'reactions',
      label: 'Кто поставил реакции',
      onSelect: () => onShowPeople('reactions'),
    })
  }
  const model: MenuModel = {
    reactions: canWrite
      ? REACTIONS.map((emoji) => ({ emoji, mine: mineReactions.has(emoji) }))
      : null,
    onReact,
    actions,
  }
  const hasMenu = model.reactions !== null || actions.length > 0

  let body: ReactNode = <MessageText body={message.body} />
  if (editing) {
    body = (
      <EditForm
        thread={thread}
        message={message}
        onDone={() => onEditingChange(false)}
      />
    )
  }

  const bubble = (
    <article
      aria-label={`Сообщение ${author}, ${formatTimeMsk(message.createdAt)}`}
      className={cn(
        'group relative grid max-w-[min(100%,560px)] min-w-0 gap-1.5 rounded-xl border px-3 py-2',
        message.mine
          ? 'border-border-accent bg-secondary'
          : 'border-border bg-surface-inset',
      )}
    >
      <header className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 pr-8 text-xs">
        <span
          className={cn(
            'font-bold',
            message.author.state === 'shown'
              ? 'text-foreground'
              : 'text-muted-foreground',
          )}
        >
          {author}
        </span>
        {message.author.state === 'shown' && message.author.badge ? (
          <span className="rounded-full border border-border-accent px-1.5 text-2xs text-tag-foreground">
            {message.author.badge === 'admin' ? 'Админ' : 'Офицер'}
          </span>
        ) : null}
        <time dateTime={message.createdAt} className="text-muted-foreground">
          {formatTimeMsk(message.createdAt)}
        </time>
        {message.editedAt ? (
          <span className="text-muted-foreground">изменено</span>
        ) : null}
      </header>
      {message.replyTo ? (
        <blockquote className="m-0 grid gap-0.5 border-l-2 border-primary py-0.5 pl-2 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">
            {message.replyTo.gameNickname ?? DELETED}
          </span>
          <span className="line-clamp-2 wrap-anywhere whitespace-pre-wrap">
            {message.replyTo.excerpt}
          </span>
        </blockquote>
      ) : null}
      {body}
      {message.reactions.length > 0 || message.mine ? (
        <footer className="flex flex-wrap items-center gap-1.5">
          {message.reactions.map((reaction) => (
            <button
              key={reaction.emoji}
              type="button"
              disabled={!canWrite}
              aria-pressed={reaction.mine}
              aria-label={`${reaction.emoji} ${reaction.count}`}
              onClick={() => onReact(reaction.emoji)}
              className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-border bg-transparent px-2 py-0.5 text-xs text-foreground disabled:cursor-default aria-pressed:border-border-accent aria-pressed:bg-accent"
            >
              <span aria-hidden="true">{reaction.emoji}</span>
              <span aria-hidden="true">{reaction.count}</span>
            </button>
          ))}
          {message.mine ? (
            <span
              className="ml-auto inline-flex items-center gap-1 text-2xs text-muted-foreground"
              title={read ? 'Прочитано' : 'Отправлено'}
            >
              {read ? (
                <CheckCheck size={14} aria-hidden="true" />
              ) : (
                <Check size={14} aria-hidden="true" />
              )}
              {read ? 'Прочитано' : 'Отправлено'}
            </span>
          ) : null}
        </footer>
      ) : null}
      {hasMenu && !editing ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Действия с сообщением ${author}`}
            className="absolute top-1 right-1 grid size-8 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-muted-foreground opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100"
          >
            <Ellipsis size={18} aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <MenuItems
              model={model}
              Item={DropdownMenuItem}
              Label={DropdownMenuLabel}
              Separator={DropdownMenuSeparator}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </article>
  )

  return (
    <div className="grid gap-2">
      {dateLabel ? (
        <div className="flex items-center gap-3 text-2xs tracking-[0.12em] text-muted-foreground uppercase">
          <hr className="m-0 h-px flex-1 border-0 bg-border" />
          <span>{dateLabel}</span>
          <hr className="m-0 h-px flex-1 border-0 bg-border" />
        </div>
      ) : null}
      <div
        className={cn(
          'flex min-w-0 items-start gap-2',
          message.mine && 'flex-row-reverse',
        )}
      >
        <Avatar
          name={author}
          src={
            message.author.state === 'shown' ? message.author.avatarUrl : null
          }
          className="max-xs:hidden"
        />
        {hasMenu && !editing ? (
          <ContextMenu>
            <ContextMenuTrigger asChild>{bubble}</ContextMenuTrigger>
            <ContextMenuContent>
              <MenuItems
                model={model}
                Item={ContextMenuItem}
                Label={ContextMenuLabel}
                Separator={ContextMenuSeparator}
              />
            </ContextMenuContent>
          </ContextMenu>
        ) : (
          bubble
        )}
      </div>
    </div>
  )
}
