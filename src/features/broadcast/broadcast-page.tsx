import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useForm, useStore } from '@tanstack/react-form'
import { X } from 'lucide-react'
import { z } from 'zod'
import {
  BROADCAST_CHANNEL_LABELS,
  BROADCAST_CHANNELS,
  BROADCAST_LIMITS,
  BROADCAST_SOURCES,
  type BroadcastChannel,
  type BroadcastDraft,
  type BroadcastRecipient,
  type BroadcastSource,
} from '@contracts/broadcasts'
import { ConfirmActionDialog } from '@/components/confirm-action-dialog'
import { focusFirstInvalid } from '@/components/form/focus-first-invalid'
import { FormError } from '@/components/form/form-error'
import {
  FormField,
  fieldError,
  formGridClass,
} from '@/components/form/form-field'
import { EmptyState } from '@/components/states/empty-state'
import { ErrorState } from '@/components/states/error-state'
import { LoadingState } from '@/components/states/loading-state'
import { PageHeader } from '@/components/states/page-header'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Badge, Card, Notice } from '@/components/ui/surfaces'
import { toast } from '@/components/ui/toaster'
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard'
import { formErrorMessage, fieldMessage } from '@/lib/errors'
import { formatDateTimeMsk } from '@/lib/format-date'
import { cn } from '@/lib/utils'
import {
  useBroadcastTemplates,
  useDeleteBroadcastTemplate,
  useDeleteDraft,
  useDrafts,
  usePrefill,
  useSaveBroadcastTemplate,
  useSaveDraft,
} from './api'

/** Источник заполнения в адресе: `?source=event&id=…` (BRC-02–04). */
export const broadcastSearchSchema = z.object({
  source: z.enum(BROADCAST_SOURCES).optional().catch(undefined),
  id: z.guid().optional().catch(undefined),
})
export type BroadcastSearch = z.output<typeof broadcastSearchSchema>

const SOURCE_LABELS: Record<BroadcastSource, string> = {
  event: 'событие',
  vote: 'голосование',
  group: 'группа',
}

const checkboxClass =
  'flex cursor-pointer items-center gap-2 text-sm text-foreground [&>input]:size-4 [&>input]:accent-primary'

const draftSchema = z.object({
  subject: z.string().max(BROADCAST_LIMITS.subject, 'too_long'),
  body: z
    .string()
    .trim()
    .min(1, 'required')
    .max(BROADCAST_LIMITS.body, 'too_long'),
  channels: z.array(z.enum(BROADCAST_CHANNELS)).min(1, 'required'),
})

type FormValues = {
  subject: string
  body: string
  channels: BroadcastChannel[]
}

const ALL_CHANNELS = [...BROADCAST_CHANNELS]
const EMPTY: FormValues = {
  subject: '',
  body: '',
  channels: ALL_CHANNELS,
}

function ChannelBadges({ channels }: { channels: BroadcastChannel[] }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {channels.map((channel) => (
        <Badge key={channel}>{BROADCAST_CHANNEL_LABELS[channel]}</Badge>
      ))}
    </span>
  )
}

/** Шаблоны: применить, удалить, сохранить текущую форму (BRC-10, BRC-11). */
function Templates({
  current,
  onApply,
}: {
  current: () => FormValues
  onApply: (values: Pick<FormValues, 'subject' | 'body' | 'channels'>) => void
}) {
  const templates = useBroadcastTemplates()
  const save = useSaveBroadcastTemplate()
  const remove = useDeleteBroadcastTemplate()
  const [name, setName] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(
    null,
  )

  async function saveTemplate() {
    const values = current()
    if (!name.trim()) {
      setNameError(fieldMessage('required'))
      return
    }
    setNameError(null)
    await save
      .mutateAsync({
        name: name.trim(),
        subject: values.subject,
        body: values.body,
        channels: values.channels,
      })
      .then(() => {
        setName('')
        toast('Шаблон сохранён')
      })
      .catch(() => undefined)
  }

  const serverNameError = save.error?.fields.name ?? save.error?.fields.body
  return (
    <section aria-labelledby="templates-title" className="grid gap-3">
      <h2 id="templates-title" className="m-0 text-xl font-bold">
        Шаблоны
      </h2>
      {templates.isPending ? (
        <LoadingState label="Загружаем шаблоны…" rows={1} />
      ) : templates.isError ? (
        <ErrorState onRetry={() => void templates.refetch()} />
      ) : templates.data.items.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">Шаблонов пока нет.</p>
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0">
          {templates.data.items.map((template) => (
            <li
              key={template.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-inset px-3 py-2"
            >
              <span className="min-w-0 flex-1 break-words">
                <strong>{template.name}</strong>
                {template.author ? (
                  <span className="text-xs text-muted-foreground">
                    {' '}
                    · {template.author.gameNickname}
                  </span>
                ) : null}
              </span>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() =>
                  onApply({
                    subject: template.subject ?? '',
                    body: template.body,
                    channels: template.channels,
                  })
                }
              >
                Применить
              </Button>
              {template.canDelete ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={`Удалить шаблон «${template.name}»`}
                  onClick={() =>
                    setDeleting({ id: template.id, name: template.name })
                  }
                >
                  <X size={16} aria-hidden="true" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 max-[520px]:grid-cols-1">
        <FormField
          id="template-name"
          label="Название шаблона"
          error={
            nameError ??
            (serverNameError ? fieldMessage(serverNameError) : null)
          }
          className="min-w-0"
        >
          <Input
            id="template-name"
            value={name}
            maxLength={BROADCAST_LIMITS.templateName}
            onChange={(event) => setName(event.target.value)}
            aria-invalid={nameError || serverNameError ? true : undefined}
          />
        </FormField>
        <Button
          type="button"
          variant="secondary"
          disabled={save.isPending}
          onClick={() => void saveTemplate()}
        >
          Сохранить как шаблон
        </Button>
      </div>
      <p className="m-0 text-xs text-muted-foreground">
        В шаблон попадают тема, текст и каналы; файлы — нет. Не больше{' '}
        {BROADCAST_LIMITS.templates} шаблонов на всех.
      </p>
      <FormError
        message={
          save.error?.fields.limit
            ? `Уже ${BROADCAST_LIMITS.templates} шаблонов: удалите ненужный.`
            : save.error && !serverNameError
              ? formErrorMessage(save.error)
              : null
        }
      />
      <ConfirmActionDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleting(null)
          }
        }}
        title={`Удалить шаблон «${deleting?.name ?? ''}»?`}
        description="Шаблон исчезнет у всех офицеров и администраторов."
        confirmLabel="Удалить"
        pendingLabel="Удаляем…"
        onConfirm={async () => {
          if (deleting) {
            await remove.mutateAsync(deleting.id)
            toast('Шаблон удалён')
          }
        }}
      />
    </section>
  )
}

function DraftCard({
  draft,
  onDelete,
}: {
  draft: BroadcastDraft
  onDelete: (draft: BroadcastDraft) => void
}) {
  return (
    <li className="grid gap-2 rounded-xl border border-border bg-surface-inset p-3">
      <div className="grid gap-1.5">
        <Badge className="justify-self-start border-border text-muted-foreground">
          Черновик · отправка после подключения
        </Badge>
        <strong className="min-w-0 break-words">
          {draft.subject ?? 'Рассылка без темы'}
        </strong>
      </div>
      <p className="m-0 line-clamp-4 break-words whitespace-pre-line text-sm text-muted-foreground">
        {draft.body}
      </p>
      <ChannelBadges channels={draft.channels} />
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>
          {formatDateTimeMsk(draft.createdAt)} ·{' '}
          {draft.author?.gameNickname ?? 'Пользователь удалён'}
        </span>
        {draft.canDelete ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto text-destructive"
            onClick={() => onDelete(draft)}
          >
            Удалить
          </Button>
        ) : null}
      </div>
    </li>
  )
}

function Drafts() {
  const drafts = useDrafts()
  const remove = useDeleteDraft()
  const [deleting, setDeleting] = useState<BroadcastDraft | null>(null)
  let content
  if (drafts.isPending) {
    content = <LoadingState label="Загружаем черновики…" rows={2} />
  } else if (drafts.isError) {
    content = <ErrorState onRetry={() => void drafts.refetch()} />
  } else if (drafts.data.items.length === 0) {
    content = <EmptyState title="Черновиков пока нет" />
  } else {
    content = (
      <ul className="m-0 grid list-none gap-2.5 p-0">
        {drafts.data.items.map((draft) => (
          <DraftCard key={draft.id} draft={draft} onDelete={setDeleting} />
        ))}
      </ul>
    )
  }
  return (
    <Card className="grid gap-3">
      <h2 className="m-0 text-xl font-bold">Черновики</h2>
      <p className="m-0 text-xs text-muted-foreground">
        Хранятся последние {BROADCAST_LIMITS.drafts} черновиков; они общие для
        офицеров и администраторов.
      </p>
      {content}
      <ConfirmActionDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleting(null)
          }
        }}
        title="Удалить черновик?"
        description={deleting?.subject ?? 'Рассылка без темы'}
        confirmLabel="Удалить"
        pendingLabel="Удаляем…"
        onConfirm={async () => {
          if (deleting) {
            await remove.mutateAsync(deleting.id)
            toast('Черновик удалён')
          }
        }}
      />
    </Card>
  )
}

/** Форма подготовки (BRC-01, BRC-05–07, BRC-13). */
function BroadcastForm({
  initial,
  source,
  recipients,
  onSaved,
}: {
  initial: FormValues
  source: { kind: BroadcastSource; id: string } | null
  recipients: BroadcastRecipient[] | null
  onSaved: () => void
}) {
  const save = useSaveDraft()
  const form = useForm({
    defaultValues: initial,
    validators: { onChange: draftSchema },
    onSubmitInvalid: focusFirstInvalid,
    onSubmit: async ({ value }) => {
      await save
        .mutateAsync({
          subject: value.subject,
          body: value.body,
          channels: value.channels,
          source,
        })
        .then(() => {
          form.reset(EMPTY)
          toast('Сохранено как черновик, не отправлено')
          onSaved()
        })
        .catch(focusFirstInvalid)
    },
  })
  const isDirty = useStore(form.store, (state) => state.isDirty)
  const { dialog } = useUnsavedChangesGuard(isDirty)

  return (
    <div className="grid gap-5">
      <form
        noValidate
        className={formGridClass}
        onSubmit={(event) => {
          event.preventDefault()
          void form.handleSubmit()
        }}
      >
        {recipients ? (
          <Notice className="col-span-full">
            Получателей в группе: {recipients.length}. Адреса в мессенджерах
            сайт не хранит — список нужен для текста рассылки.
          </Notice>
        ) : null}
        <form.Subscribe selector={(state) => state.submissionAttempts > 0}>
          {(submitted) => (
            <>
              <form.Field name="subject">
                {(field) => {
                  const error = fieldError(
                    field.state.meta,
                    submitted,
                    save.error?.fields.subject,
                  )
                  return (
                    <FormField
                      id="broadcast-subject"
                      label="Тема (необязательно)"
                      error={error}
                      className="col-span-full"
                    >
                      <Input
                        id="broadcast-subject"
                        value={field.state.value}
                        maxLength={BROADCAST_LIMITS.subject}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                        onBlur={field.handleBlur}
                        aria-invalid={error ? true : undefined}
                      />
                    </FormField>
                  )
                }}
              </form.Field>
              <form.Field name="body">
                {(field) => {
                  const error = fieldError(
                    field.state.meta,
                    submitted,
                    save.error?.fields.body,
                  )
                  return (
                    <FormField
                      id="broadcast-body"
                      label="Текст рассылки"
                      error={error}
                      className="col-span-full"
                    >
                      <Textarea
                        id="broadcast-body"
                        rows={9}
                        value={field.state.value}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                        onBlur={field.handleBlur}
                        aria-invalid={error ? true : undefined}
                        aria-describedby={
                          error ? 'broadcast-body-error' : undefined
                        }
                      />
                    </FormField>
                  )
                }}
              </form.Field>
              <form.Field name="channels">
                {(field) => {
                  const error = fieldError(
                    field.state.meta,
                    submitted,
                    save.error?.fields.channels,
                  )
                  return (
                    <fieldset className="col-span-full m-0 grid gap-2 border-0 p-0">
                      <legend className="mb-2 text-sm font-semibold">
                        Каналы
                      </legend>
                      <div className="flex flex-wrap gap-4">
                        {BROADCAST_CHANNELS.map((channel) => (
                          <label key={channel} className={checkboxClass}>
                            <input
                              type="checkbox"
                              checked={field.state.value.includes(channel)}
                              onChange={(event) =>
                                field.handleChange(
                                  event.target.checked
                                    ? [...field.state.value, channel]
                                    : field.state.value.filter(
                                        (item) => item !== channel,
                                      ),
                                )
                              }
                            />
                            {BROADCAST_CHANNEL_LABELS[channel]}
                          </label>
                        ))}
                      </div>
                      {error ? (
                        <span role="alert" className="text-xs text-destructive">
                          Выберите хотя бы один канал
                        </span>
                      ) : null}
                    </fieldset>
                  )
                }}
              </form.Field>
            </>
          )}
        </form.Subscribe>
        <div className="col-span-full grid gap-3">
          <FormError
            message={
              save.error && !save.error.fields.body
                ? formErrorMessage(save.error)
                : null
            }
          />
          <div className="flex flex-wrap items-center gap-3">
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(submitting) => (
                <Button type="submit" disabled={submitting}>
                  {submitting ? 'Сохраняем…' : 'Сохранить черновик'}
                </Button>
              )}
            </form.Subscribe>
            <Button
              type="button"
              variant="secondary"
              disabled
              aria-describedby="broadcast-send-hint"
            >
              Отправить рассылку
            </Button>
          </div>
          <p
            id="broadcast-send-hint"
            className="m-0 text-xs text-muted-foreground"
          >
            Платформы не подключены: сайт сохраняет черновик, но ничего не
            отправляет.
          </p>
        </div>
        {dialog}
      </form>
      <Templates
        current={() => form.state.values}
        onApply={(values) => {
          form.setFieldValue('subject', values.subject)
          form.setFieldValue('body', values.body)
          form.setFieldValue('channels', values.channels)
          toast('Шаблон применён')
        }}
      />
    </div>
  )
}

/** «Рассылка»: только подготовка черновиков, без отправки (BRC, Q-22). */
export function BroadcastPage({ source, id }: Partial<BroadcastSearch>) {
  const navigate = useNavigate()
  const target = source && id ? { source, id } : null
  const prefill = usePrefill(target)
  // Черновик сохранён — форма чистая: переход без вопроса о потере данных.
  const clearSource = () =>
    void navigate({ to: '/broadcast', search: {}, ignoreBlocker: true })

  let form
  if (target && prefill.isPending) {
    form = <LoadingState label="Заполняем текст…" rows={3} />
  } else if (target && prefill.isError) {
    form = (
      <div className="grid gap-3">
        <Notice role="alert">
          {prefill.error.code === 'state_conflict'
            ? 'Подготовить рассылку нельзя: событие или голосование уже завершено, либо группа пуста.'
            : formErrorMessage(prefill.error)}
        </Notice>
        <Button
          type="button"
          variant="secondary"
          className="justify-self-start"
          onClick={clearSource}
        >
          Пустая форма
        </Button>
      </div>
    )
  } else {
    const data = target ? prefill.data : undefined
    form = (
      <BroadcastForm
        // Открытие из другого контекста — новая форма с включёнными каналами
        // (BRC-05).
        key={target ? `${target.source}:${target.id}` : 'blank'}
        initial={
          data
            ? {
                subject: data.subject,
                body: data.body,
                channels: ALL_CHANNELS,
              }
            : EMPTY
        }
        source={target ? { kind: target.source, id: target.id } : null}
        recipients={data?.recipients ?? null}
        onSaved={target ? clearSource : () => undefined}
      />
    )
  }

  return (
    <section className="grid gap-5">
      <PageHeader
        title="Рассылка"
        description="Подготовка сообщений для Telegram, ВКонтакте и MAX. Отправка появится после подключения ботов."
      />
      <div
        className={cn(
          'grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] items-start gap-5 max-[900px]:grid-cols-1',
        )}
      >
        <Card className="grid gap-4">
          {target ? (
            <p className="m-0 text-sm text-muted-foreground">
              Заполнено из контекста: {SOURCE_LABELS[target.source]}. Текст
              можно изменить.
            </p>
          ) : null}
          {form}
        </Card>
        <Drafts />
      </div>
    </section>
  )
}
