import { useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useForm, useStore } from '@tanstack/react-form'
import { Send, X } from 'lucide-react'
import { z } from 'zod'
import { useAccess } from '@/app/access'
import {
  BROADCAST_CHANNEL_LABELS,
  BROADCAST_CHANNELS,
  BROADCAST_LIMITS,
  BROADCAST_SOURCES,
  SENDABLE_CHANNELS,
  type BroadcastChannel,
  type BroadcastRecipientsResponse,
  type BroadcastDraft,
  type BroadcastRecipient,
  type BroadcastSource,
  type SendAnnouncementResponse,
  type SendableChannel,
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
import { MEMBER_LIST_LIMIT } from '@contracts/paging'
import { AppError, formErrorMessage, fieldMessage } from '@/lib/errors'
import { formatDateTimeMsk } from '@/lib/format-date'
import { cn } from '@/lib/utils'
import { SubscriptionsPanel } from './subscriptions-panel'
import {
  RecipientExclusions,
  type ExcludedRecipient,
} from './recipient-exclusions'
import {
  useBroadcastTemplates,
  useDeleteBroadcastTemplate,
  useDeleteDraft,
  useDrafts,
  usePrefill,
  useSaveBroadcastTemplate,
  useFetchRecipients,
  useSaveDraft,
  useSendAnnouncement,
} from './api'

/** Источник заполнения в адресе: `?source=event&id=…` (BRC-02–04). */
export const broadcastSearchSchema = z.object({
  source: z.enum(BROADCAST_SOURCES).optional().catch(undefined),
  id: z.guid().optional().catch(undefined),
  unlinkedOnly: z.boolean().catch(false),
})
export type BroadcastSearch = z.output<typeof broadcastSearchSchema>

const SOURCE_LABELS: Record<BroadcastSource, string> = {
  event: 'событие',
  vote: 'голосование',
  group: 'группа',
}

const checkboxClass =
  'flex cursor-pointer items-center gap-2 text-sm text-foreground [&>input]:size-4 [&>input]:accent-primary'

/** Схема формы; `bodyLimit` меньше у анонса с картинкой (TGM-28). */
const draftSchema = (bodyLimit: number, initialSubjectBudget?: number) =>
  z
    .object({
      subject: z.string().max(BROADCAST_LIMITS.subject, 'too_long'),
      body: z
        .string()
        .trim()
        .min(1, 'required')
        .max(
          initialSubjectBudget === undefined
            ? bodyLimit
            : BROADCAST_LIMITS.body,
          'too_long',
        ),
      channels: z.array(z.enum(BROADCAST_CHANNELS)).min(1, 'required'),
      excludedRecipients: z
        .array(
          z.object({
            id: z.guid(),
            channels: z.array(z.enum(SENDABLE_CHANNELS)).min(1),
          }),
        )
        .max(MEMBER_LIST_LIMIT),
    })
    .superRefine(({ subject, body }, context) => {
      if (initialSubjectBudget === undefined) {
        return
      }
      const currentSubject = subject.trim()
      const currentSubjectBudget = currentSubject
        ? currentSubject.length + 2
        : 0
      const currentLimit = Math.max(
        0,
        bodyLimit + initialSubjectBudget - currentSubjectBudget,
      )
      if (body.trim().length > currentLimit) {
        context.addIssue({
          code: 'custom',
          path: ['body'],
          message: 'too_long',
        })
      }
    })

type FormValues = {
  subject: string
  body: string
  channels: BroadcastChannel[]
  excludedRecipients: ExcludedRecipient[]
}

/** Подключены Telegram, ВКонтакте и MAX (Q-99, Q-102). */
const CONNECTED_CHANNELS: readonly BroadcastChannel[] = SENDABLE_CHANNELS
const connectedOnly = (channels: BroadcastChannel[]) =>
  channels.filter((channel) => CONNECTED_CHANNELS.includes(channel))
const EMPTY: FormValues = {
  subject: '',
  body: '',
  channels: [...CONNECTED_CHANNELS],
  excludedRecipients: [],
}

const NO_RECIPIENTS =
  'Отправить некому: никто из участников клана не привязал выбранные мессенджеры.'
const NO_GROUP_RECIPIENTS =
  'Отправить некому: никто из участников группы не привязал выбранные мессенджеры.'
const ALL_ANSWERED =
  'Отправить некому: все участники, привязавшие выбранные мессенджеры, уже ответили на событие.'
const ALL_EXCLUDED = 'После исключений получателей не осталось'

const isSendable = (channel: BroadcastChannel): channel is SendableChannel =>
  (SENDABLE_CHANNELS as readonly BroadcastChannel[]).includes(channel)

type ChannelCounts = Partial<Record<SendableChannel, number>>

/**
 * Получатели выбранных каналов (MAX-05). Прежний сервер без `channels`
 * знает только Telegram. Канал без бота на сервере — текст отказа.
 */
function chosenCounts(
  response: BroadcastRecipientsResponse,
  chosen: SendableChannel[],
): ChannelCounts | string {
  const channels = response.channels ?? {
    telegram: { configured: true, count: response.count },
    vk: { configured: false, count: 0 },
    max: { configured: false, count: 0 },
  }
  const counts: ChannelCounts = {}
  for (const channel of chosen) {
    if (!channels[channel].configured) {
      return `${BROADCAST_CHANNEL_LABELS[channel]} не подключён на сервере: снимите этот флажок.`
    }
    counts[channel] = channels[channel].count
  }
  return counts
}

const countsText = (counts: ChannelCounts) =>
  SENDABLE_CHANNELS.filter((channel) => channel in counts)
    .map(
      (channel) => `${BROADCAST_CHANNEL_LABELS[channel]}: ${counts[channel]}`,
    )
    .join(', ')

/** Итог для toast: отправленные по каналам и недоставленные (MAX-10). */
function sentText(result: SendAnnouncementResponse, chosen: SendableChannel[]) {
  const sent = result.channels
    ? countsText(
        Object.fromEntries(
          SENDABLE_CHANNELS.filter((c) => result.channels?.[c]).map((c) => [
            c,
            result.channels![c]!.sent,
          ]),
        ),
      )
    : `${chosen.map((c) => BROADCAST_CHANNEL_LABELS[c]).join(', ')}: ${result.sent}`
  return result.failed > 0
    ? `Отправлено — ${sent}. Не доставлено: ${result.failed}`
    : `Отправлено — ${sent}`
}

/** Причина отказа отправки (Q-92, Q-104, Q-109). */
function sendRefusal(error: AppError, forGroup: boolean) {
  if (error.code !== 'state_conflict') {
    return null
  }
  switch (error.fields.reason) {
    case 'excluded_no_recipients':
      return ALL_EXCLUDED
    case 'no_recipients':
      return forGroup ? NO_GROUP_RECIPIENTS : NO_RECIPIENTS
    case 'all_answered':
      return ALL_ANSWERED
    case 'group_missing':
      return 'Группа удалена: анонс группы не отправлен.'
    case 'started':
      return 'Событие уже началось: анонс с кнопками ответа не отправляется.'
    case 'closed':
      return forGroup
        ? 'Событие группы завершено: анонс не отправлен.'
        : 'Событие завершено: анонс с кнопками ответа не отправляется.'
    default:
      return null
  }
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
  canSend,
  canManageTemplates,
}: {
  current: () => FormValues
  onApply: (values: Pick<FormValues, 'subject' | 'body' | 'channels'>) => void
  canSend: boolean
  canManageTemplates: boolean
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
      {canManageTemplates ? (
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
      ) : null}
      {canManageTemplates ? (
        <p className="m-0 text-xs text-muted-foreground">
          В шаблон попадают тема, текст и каналы. Не больше{' '}
          {BROADCAST_LIMITS.templates} шаблонов на всех.
        </p>
      ) : null}
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
              {canSend ? (
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
              ) : null}
              {canManageTemplates && template.canDelete ? (
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
          Черновик
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
      <div
        className={cn(
          'rounded-lg',
          drafts.data.items.length > 3 &&
            'max-h-[44rem] overflow-y-auto overscroll-contain',
        )}
      >
        <ul className="m-0 grid list-none gap-2.5 p-0">
          {drafts.data.items.map((draft) => (
            <DraftCard key={draft.id} draft={draft} onDelete={setDeleting} />
          ))}
        </ul>
      </div>
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

/** Форма подготовки и отправки (BRC-01, BRC-05–07, BRC-13, TGM-11–TGM-16, MAX-05). */
function BroadcastForm({
  initial,
  source,
  recipients,
  bodyLimit,
  onSaved,
  canSend,
  canManageTemplates,
}: {
  initial: FormValues
  source: { kind: BroadcastSource; id: string } | null
  recipients: BroadcastRecipient[] | null
  /** Лимит текста: у постоянного события меньше — анонс с картинкой. */
  bodyLimit: number
  onSaved: () => void
  canSend: boolean
  canManageTemplates: boolean
}) {
  const save = useSaveDraft()
  const send = useSendAnnouncement()
  const fetchRecipients = useFetchRecipients()
  // Вид анонса задаёт источник формы и не меняется (TGM-12, Q-104):
  // событие — с кнопками, группа — только её участникам.
  const eventId = source?.kind === 'event' ? source.id : null
  const groupId = source?.kind === 'group' ? source.id : null
  const voteId = source?.kind === 'vote' ? source.id : null
  // Одна проверка формы для двух действий: черновик или отправка.
  const intent = useRef<'save' | 'send'>('save')
  const [checking, setChecking] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [confirmCounts, setConfirmCounts] = useState<ChannelCounts | null>(null)
  const initialSubject = initial.subject.trim()
  const initialSubjectBudget = initialSubject ? initialSubject.length + 2 : 0
  const schema = useMemo(
    () =>
      draftSchema(
        bodyLimit,
        voteId === null ? undefined : initialSubjectBudget,
      ),
    [bodyLimit, initialSubjectBudget, voteId],
  )
  const form = useForm({
    defaultValues: { ...EMPTY, ...initial },
    validators: { onChange: schema },
    onSubmitInvalid: focusFirstInvalid,
    onSubmit: async ({ value }) => {
      if (intent.current === 'send') {
        await confirmSend()
        return
      }
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
  const currentSubject = useStore(form.store, (state) => state.values.subject)
  const currentSubjectText = currentSubject.trim()
  const currentSubjectBudget = currentSubjectText
    ? currentSubjectText.length + 2
    : 0
  const currentBodyLimit =
    voteId === null
      ? bodyLimit
      : Math.max(0, bodyLimit + initialSubjectBudget - currentSubjectBudget)
  const { dialog } = useUnsavedChangesGuard(isDirty)
  const chosen = useStore(form.store, (state) =>
    state.values.channels.filter(isSendable),
  )

  /** После проверки формы — получатели по каналам и подтверждение (MAX-05). */
  async function confirmSend() {
    setSendError(null)
    setChecking(true)
    try {
      const excludedUserIds = form.state.values.excludedRecipients.map(
        (recipient) => recipient.id,
      )
      const response = await fetchRecipients(groupId, eventId, excludedUserIds)
      const counts = chosenCounts(response, chosen)
      if (typeof counts === 'string') {
        setSendError(counts)
      } else if (Object.values(counts).every((count) => count === 0)) {
        setSendError(
          excludedUserIds.length > 0
            ? ALL_EXCLUDED
            : groupId
              ? NO_GROUP_RECIPIENTS
              : chosen.some((c) => (response.channels?.[c].answered ?? 0) > 0)
                ? ALL_ANSWERED
                : NO_RECIPIENTS,
        )
      } else {
        setConfirmCounts(counts)
      }
    } catch (error) {
      setSendError(formErrorMessage(error as AppError))
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-5 min-[1600px]:grid-cols-2">
      <div className="grid min-w-0 content-start gap-5">
        <form
          noValidate
          className="grid min-w-0"
          onSubmit={(event) => {
            event.preventDefault()
            void form.handleSubmit()
          }}
        >
          <Card className={cn('grid min-w-0 gap-4', formGridClass)}>
            {source ? (
              <p className="col-span-full m-0 text-sm text-muted-foreground">
                Заполнено из контекста: {SOURCE_LABELS[source.kind]}. Текст
                можно изменить.
              </p>
            ) : null}
            {voteId ? (
              <Notice className="col-span-full">
                Анонс голосования: участники смогут выбрать вариант кнопкой в
                мессенджере или открыть голосование на сайте. Текст ниже можно
                изменить.
              </Notice>
            ) : null}
            {eventId ? (
              <Notice className="col-span-full">
                Анонс события: в мессенджеры придёт с кнопками «Приду», «50/50»
                и «Не приду».
              </Notice>
            ) : null}
            {groupId ? (
              <Notice className="col-span-full">
                Анонс группы: получат только участники группы, привязавшие
                мессенджеры, — текстом без кнопок.
                {recipients ? ` Сейчас в группе: ${recipients.length}.` : null}
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
                          hint={
                            currentBodyLimit < BROADCAST_LIMITS.body
                              ? voteId
                                ? `Лимит учитывает варианты голосования: не больше ${currentBodyLimit} символов. Сейчас: ${field.state.value.trim().length}.`
                                : `Анонс придёт в мессенджеры с картинкой события, поэтому текст — не длиннее ${currentBodyLimit} символов. Сейчас: ${field.state.value.trim().length}.`
                              : undefined
                          }
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
                              [
                                currentBodyLimit < BROADCAST_LIMITS.body
                                  ? 'broadcast-body-hint'
                                  : '',
                                error ? 'broadcast-body-error' : '',
                              ]
                                .filter(Boolean)
                                .join(' ') || undefined
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
                            {BROADCAST_CHANNELS.map((channel) => {
                              const connected =
                                CONNECTED_CHANNELS.includes(channel)
                              return (
                                <label
                                  key={channel}
                                  className={cn(
                                    checkboxClass,
                                    !connected &&
                                      'cursor-not-allowed text-muted-foreground',
                                  )}
                                >
                                  <input
                                    type="checkbox"
                                    disabled={!connected}
                                    checked={
                                      connected &&
                                      field.state.value.includes(channel)
                                    }
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
                                  {connected ? null : (
                                    <span className="-ml-1 text-xs">
                                      — не подключено
                                    </span>
                                  )}
                                </label>
                              )
                            })}
                          </div>
                          {error ? (
                            <span
                              role="alert"
                              className="text-xs text-destructive"
                            >
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
              {canSend ? (
                <div className="flex flex-wrap items-center gap-3">
                  <form.Subscribe selector={(state) => state.isSubmitting}>
                    {(submitting) => (
                      <Button
                        type="submit"
                        disabled={submitting}
                        onClick={() => {
                          intent.current = 'save'
                        }}
                      >
                        {submitting && intent.current === 'save'
                          ? 'Сохраняем…'
                          : 'Сохранить черновик'}
                      </Button>
                    )}
                  </form.Subscribe>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={chosen.length === 0 || checking}
                    aria-describedby="broadcast-send-hint"
                    onClick={() => {
                      intent.current = 'send'
                      void form.handleSubmit()
                    }}
                  >
                    <Send size={16} aria-hidden="true" />
                    {checking ? 'Проверяем…' : 'Отправить анонс'}
                  </Button>
                </div>
              ) : null}
              <FormError message={sendError} />
              <p
                id="broadcast-send-hint"
                className="m-0 text-xs text-muted-foreground"
              >
                {groupId
                  ? 'Анонс получат участники группы — члены, офицеры и администраторы, привязавшие выбранные мессенджеры.'
                  : eventId
                    ? 'Анонс получат члены, офицеры и администраторы, привязавшие выбранные мессенджеры, кроме уже ответивших на событие.'
                    : 'Анонс получат члены, офицеры и администраторы, привязавшие выбранные мессенджеры.'}{' '}
                После отправки текст не изменить. Черновик при отправке не
                сохраняется.
              </p>
            </div>
          </Card>
          <ConfirmActionDialog
            open={confirmCounts !== null}
            onOpenChange={(open) => {
              if (!open) {
                setConfirmCounts(null)
              }
            }}
            title="Отправить анонс?"
            description={`Получателей — ${countsText(confirmCounts ?? {})}. ${
              eventId
                ? 'Анонс события придёт с кнопками ответа.'
                : groupId
                  ? 'Анонс придёт только участникам группы, текстом без кнопок.'
                  : voteId
                    ? 'Анонс голосования придёт с кнопками вариантов ответа.'
                    : 'Анонс придёт текстом без кнопок.'
            } Отправленный анонс не редактируется.`}
            confirmLabel="Отправить"
            pendingLabel="Отправляем…"
            errorText={(error) => sendRefusal(error, groupId !== null)}
            onConfirm={async () => {
              const values = form.state.values
              const channels = values.channels.filter(isSendable)
              const result = await send.mutateAsync({
                subject: values.subject,
                body: values.body,
                eventId,
                groupId,
                ...(voteId ? { voteId } : {}),
                channels,
                ...(values.excludedRecipients.length > 0
                  ? {
                      excludedUserIds: values.excludedRecipients.map(
                        (recipient) => recipient.id,
                      ),
                    }
                  : {}),
              })
              toast(sentText(result, channels))
              form.reset(EMPTY)
              onSaved()
            }}
          />
          {dialog}
        </form>
        <Templates
          canSend={canSend}
          canManageTemplates={canManageTemplates}
          current={() => form.state.values}
          onApply={(values) => {
            form.setFieldValue('subject', values.subject)
            form.setFieldValue('body', values.body)
            form.setFieldValue('channels', connectedOnly(values.channels))
            toast('Шаблон применён')
          }}
        />
      </div>
      <Card className="min-w-0">
        <form.Field name="excludedRecipients">
          {(field) => (
            <RecipientExclusions
              selectedChannels={chosen}
              groupId={groupId}
              eventId={eventId}
              excludedRecipients={field.state.value}
              onChange={field.handleChange}
            />
          )}
        </form.Field>
      </Card>
    </div>
  )
}

/** «Рассылка»: черновики, шаблоны и отправка анонса в Telegram и MAX (BRC, TGM, MAX). */
export function BroadcastPage(searchParams: Partial<BroadcastSearch>) {
  const navigate = useNavigate()
  const { hasOfficerPermission } = useAccess()
  const { source, id } = searchParams
  const unlinkedOnly = searchParams.unlinkedOnly ?? false
  const canSend = hasOfficerPermission('broadcasts.send')
  const canManageTemplates = hasOfficerPermission('broadcasts.templates')
  const canViewSubscriptions = hasOfficerPermission('broadcasts.subscriptions')
  const target = source && id ? { source, id } : null
  const prefill = usePrefill(target)
  // Черновик сохранён — форма чистая: переход без вопроса о потере данных.
  const clearSource = () =>
    void navigate({ to: '/broadcast', search: {}, ignoreBlocker: true })
  const changeUnlinkedOnly = (value: boolean) =>
    void navigate({
      to: '/broadcast',
      search: (previous) => ({
        ...previous,
        unlinkedOnly: value || undefined,
      }),
      replace: true,
      resetScroll: false,
    })

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
        // Открытие из другого контекста — новая форма с подключёнными
        // каналами (BRC-05).
        key={target ? `${target.source}:${target.id}` : 'blank'}
        initial={
          data
            ? {
                ...EMPTY,
                subject: data.subject,
                body: data.body,
                channels: [...CONNECTED_CHANNELS],
              }
            : EMPTY
        }
        source={target ? { kind: target.source, id: target.id } : null}
        recipients={data?.recipients ?? null}
        bodyLimit={data?.bodyLimit ?? BROADCAST_LIMITS.body}
        onSaved={target ? clearSource : () => undefined}
        canSend={canSend}
        canManageTemplates={canManageTemplates}
      />
    )
  }

  return (
    <section className="grid gap-5">
      <PageHeader
        title="Рассылка"
        description="Анонсы клана в Telegram, ВКонтакте и MAX: отдельные, событий и голосований с кнопками ответа."
      />
      <div
        className={cn(
          'grid min-w-0 grid-cols-1 items-start gap-5',
          canSend || canManageTemplates
            ? 'min-[1100px]:grid-cols-2 min-[1600px]:grid-cols-4'
            : '',
        )}
      >
        <div className="min-w-0 min-[1600px]:col-span-2">
          {canSend || canManageTemplates ? form : null}
        </div>
        <div className="grid min-w-0 content-start gap-5 min-[1600px]:contents">
          {canSend ? <Drafts /> : null}
          {canViewSubscriptions ? (
            <Card className="grid min-w-0 gap-3">
              <h2 className="m-0 text-xl font-bold">Подписки</h2>
              <SubscriptionsPanel
                unlinkedOnly={unlinkedOnly}
                onUnlinkedOnlyChange={changeUnlinkedOnly}
              />
            </Card>
          ) : null}
        </div>
      </div>
    </section>
  )
}
