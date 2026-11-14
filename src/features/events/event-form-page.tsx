import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useForm, useStore } from '@tanstack/react-form'
import { ArrowLeft } from 'lucide-react'
import {
  EVENT_LIMITS,
  EVENT_TYPE_LABELS,
  EVENT_TYPES,
  eventFieldsSchema,
  type EventDetails,
  type EventFields,
  type EventTemplate,
} from '@contracts/events'
import { ConfirmActionDialog } from '@/components/confirm-action-dialog'
import { focusFirstInvalid } from '@/components/form/focus-first-invalid'
import { FormError } from '@/components/form/form-error'
import {
  FormField,
  fieldAria,
  fieldError,
  formGridClass,
} from '@/components/form/form-field'
import { EmptyState } from '@/components/states/empty-state'
import { ErrorState } from '@/components/states/error-state'
import { LoadingState } from '@/components/states/loading-state'
import { PageHeader } from '@/components/states/page-header'
import { Button, linkButtonClass } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge, Card } from '@/components/ui/surfaces'
import { toast } from '@/components/ui/toaster'
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard'
import { errorMessage, formErrorMessage, type AppError } from '@/lib/errors'
import { formatDate, formatWeekdayTimeMsk } from '@/lib/format-date'
import { cn } from '@/lib/utils'
import {
  fetchTemplateNextDate,
  useCreateEvent,
  useDeleteTemplate,
  useEvent,
  useEventTemplates,
  useSaveTemplate,
  useUpdateEvent,
} from './api'

const sectionTitleClass = 'm-0 font-sans text-base font-bold text-foreground'

const TYPE_OPTIONS = EVENT_TYPES.map((type) => ({
  value: type,
  label: EVENT_TYPE_LABELS[type],
}))

const EMPTY_FIELDS: EventFields = {
  title: '',
  type: 'pve',
  date: '',
  time: '',
  description: '',
}

function BackLink() {
  return (
    <Link
      to="/events"
      search={{ tab: 'active' }}
      className={cn(linkButtonClass, 'mb-3 inline-flex items-center gap-1.5')}
    >
      <ArrowLeft size={16} aria-hidden="true" /> К событиям
    </Link>
  )
}

type TemplateLibraryProps = {
  onApply: (fields: EventFields) => void
}

/**
 * Общая библиотека шаблонов офицеров и администраторов (EVT-13, Q-46):
 * тип, день недели, время и автор; применение и удаление с подтверждением.
 */
function TemplateLibrary({ onApply }: TemplateLibraryProps) {
  const queryClient = useQueryClient()
  const templates = useEventTemplates()
  const remove = useDeleteTemplate()
  const [deleting, setDeleting] = useState<EventTemplate | null>(null)
  const [applying, setApplying] = useState<string | null>(null)

  async function apply(template: EventTemplate) {
    setApplying(template.id)
    try {
      const next = await fetchTemplateNextDate(queryClient, template.id)
      onApply({
        title: template.title,
        type: template.type,
        date: next.date,
        time: next.time,
        description: template.description,
      })
      toast(`Ближайшая дата: ${formatDate(next.date)}, ${next.time} МСК`)
    } catch (error) {
      toast(errorMessage((error as AppError).code))
    } finally {
      setApplying(null)
    }
  }

  let content
  if (templates.isPending) {
    content = <LoadingState label="Загружаем шаблоны…" />
  } else if (templates.isError) {
    content = <ErrorState onRetry={() => void templates.refetch()} />
  } else if (templates.data.items.length === 0) {
    content = (
      <EmptyState
        title="Шаблонов пока нет"
        description="Заполните событие выше и нажмите «Сохранить как шаблон»."
      />
    )
  } else {
    content = (
      <ul
        aria-label="Шаблоны событий"
        className="m-0 grid list-none grid-cols-1 gap-2 p-0 min-[700px]:grid-cols-2"
      >
        {templates.data.items.map((template) => (
          <li
            key={template.id}
            className="grid min-w-0 gap-2 rounded-xl border border-border bg-surface-inset p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{EVENT_TYPE_LABELS[template.type]}</Badge>
              <h3 className="m-0 min-w-0 font-sans text-base font-bold break-words">
                {template.title}
              </h3>
            </div>
            <p className="m-0 text-sm text-muted-foreground first-letter:uppercase">
              Каждую неделю:{' '}
              {formatWeekdayTimeMsk(template.weekday, template.time)}
            </p>
            <p className="m-0 text-xs text-muted-foreground">
              Автор: {template.createdBy?.gameNickname ?? 'Пользователь удалён'}
            </p>
            <div className="grid grid-cols-2 gap-2 max-xs:grid-cols-1">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={applying !== null}
                onClick={() => void apply(template)}
              >
                {applying === template.id
                  ? 'Заполняем…'
                  : 'Заполнить ближайшую дату'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="text-destructive"
                onClick={() => setDeleting(template)}
              >
                Удалить
              </Button>
            </div>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <Card className="grid gap-3">
      <div className="grid gap-1">
        <h2 className={sectionTitleClass}>Шаблоны событий</h2>
        <p className="m-0 text-sm text-muted-foreground">
          Общие для офицеров и администраторов. Шаблон заполняет форму ближайшей
          датой; событие создаётся отдельной кнопкой. Не больше{' '}
          {EVENT_LIMITS.templates} шаблонов.
        </p>
      </div>
      {content}
      <ConfirmActionDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleting(null)
          }
        }}
        title={`Удалить шаблон «${deleting?.title ?? ''}»?`}
        description="Шаблон исчезнет у всех офицеров и администраторов. Созданные события не изменятся."
        confirmLabel="Удалить"
        pendingLabel="Удаляем…"
        onConfirm={async () => {
          if (deleting) {
            await remove.mutateAsync(deleting.id)
            toast('Шаблон удалён')
          }
        }}
      />
    </Card>
  )
}

type EventFormProps = {
  /** Правка существующего события; без него — создание. */
  event?: EventDetails
  /** Значения, подставленные шаблоном (смена ключа пересоздаёт форму). */
  initial?: EventFields | undefined
}

/**
 * Форма события (EVT-03): название, тип, дата и время по МСК (Q-44),
 * описание. «Сохранить как шаблон» не создаёт событие (EVT-11).
 */
function EventForm({ event, initial }: EventFormProps) {
  const navigate = useNavigate()
  const create = useCreateEvent()
  const update = useUpdateEvent()
  const saveTemplate = useSaveTemplate()
  const [serverError, setServerError] = useState<AppError | null>(null)
  const [showErrors, setShowErrors] = useState(false)
  const pending = create.isPending || update.isPending

  const defaults: EventFields = event
    ? {
        title: event.title,
        type: event.type,
        date: event.dateMsk,
        time: event.timeMsk,
        description: event.description,
      }
    : (initial ?? EMPTY_FIELDS)

  const form = useForm({
    defaultValues: defaults,
    validators: { onChange: eventFieldsSchema },
    onSubmitInvalid: focusFirstInvalid,
    onSubmit: async ({ value }) => {
      setServerError(null)
      const fields = eventFieldsSchema.parse(value)
      try {
        const saved = event
          ? await update.mutateAsync({ id: event.id, ...fields })
          : await create.mutateAsync(fields)
        toast(event ? 'Изменения сохранены' : 'Событие создано')
        await navigate(
          event
            ? {
                to: '/events/$id',
                params: { id: saved.id },
                ignoreBlocker: true,
              }
            : { to: '/events', search: { tab: 'active' }, ignoreBlocker: true },
        )
      } catch (error) {
        setServerError(error as AppError)
        focusFirstInvalid()
      }
    },
  })

  // Шаблон подставляет значения после создания формы: форма «изменена»,
  // защита от ухода предупредит о потере заполненных полей.
  const isDirty = useStore(
    form.store,
    (state) => state.isDirty || initial !== undefined,
  )
  const { dialog } = useUnsavedChangesGuard(isDirty)
  const serverFields = serverError?.fields ?? {}

  async function saveAsTemplate() {
    const parsed = eventFieldsSchema.safeParse(form.state.values)
    if (!parsed.success) {
      setShowErrors(true)
      await form.validate('change')
      toast('Заполните название, тип, дату, время и описание')
      focusFirstInvalid()
      return
    }
    try {
      await saveTemplate.mutateAsync(parsed.data)
      toast('Шаблон сохранён, событие не создано')
    } catch (error) {
      const appError = error as AppError
      toast(
        appError.fields.limit
          ? `В библиотеке уже ${EVENT_LIMITS.templates} шаблонов: удалите ненужные`
          : errorMessage(appError.code),
      )
    }
  }

  return (
    <Card>
      <form
        noValidate
        aria-label={event ? 'Редактирование события' : 'Новое событие'}
        className="grid gap-4"
        onSubmit={(submitEvent) => {
          submitEvent.preventDefault()
          void form.handleSubmit()
        }}
      >
        <form.Subscribe selector={(state) => state.submissionAttempts > 0}>
          {(submitted) => {
            const visible = submitted || showErrors
            return (
              <div className={formGridClass}>
                <form.Field name="title">
                  {(field) => {
                    const error = fieldError(
                      field.state.meta,
                      visible,
                      serverFields.title,
                    )
                    return (
                      <FormField
                        id="event-title"
                        label="Название"
                        error={error}
                      >
                        <Input
                          {...fieldAria('event-title', error)}
                          maxLength={EVENT_LIMITS.title}
                          placeholder="Например, осада территории"
                          value={field.state.value}
                          onChange={(change) =>
                            field.handleChange(change.target.value)
                          }
                          onBlur={field.handleBlur}
                        />
                      </FormField>
                    )
                  }}
                </form.Field>
                <form.Field name="type">
                  {(field) => {
                    const error = fieldError(
                      field.state.meta,
                      visible,
                      serverFields.type,
                    )
                    return (
                      <FormField
                        id="event-type"
                        label="Тип события"
                        error={error}
                      >
                        <Select
                          {...fieldAria('event-type', error)}
                          options={TYPE_OPTIONS}
                          value={field.state.value}
                          onValueChange={(value) =>
                            field.handleChange(value as EventFields['type'])
                          }
                        />
                      </FormField>
                    )
                  }}
                </form.Field>
                <form.Field name="date">
                  {(field) => {
                    const error = fieldError(
                      field.state.meta,
                      visible,
                      serverFields.date,
                    )
                    return (
                      <FormField
                        id="event-date"
                        label="Дата (МСК)"
                        error={error}
                      >
                        <Input
                          {...fieldAria('event-date', error)}
                          type="date"
                          value={field.state.value}
                          onChange={(change) =>
                            field.handleChange(change.target.value)
                          }
                          onBlur={field.handleBlur}
                        />
                      </FormField>
                    )
                  }}
                </form.Field>
                <form.Field name="time">
                  {(field) => {
                    const error = fieldError(
                      field.state.meta,
                      visible,
                      serverFields.time,
                    )
                    return (
                      <FormField
                        id="event-time"
                        label="Время (МСК)"
                        error={error}
                      >
                        <Input
                          {...fieldAria('event-time', error)}
                          type="time"
                          value={field.state.value}
                          onChange={(change) =>
                            field.handleChange(change.target.value)
                          }
                          onBlur={field.handleBlur}
                        />
                      </FormField>
                    )
                  }}
                </form.Field>
                <form.Field name="description">
                  {(field) => {
                    const error = fieldError(
                      field.state.meta,
                      visible,
                      serverFields.description,
                    )
                    return (
                      <FormField
                        id="event-description"
                        label="Описание"
                        error={error}
                        className="col-span-full"
                      >
                        <Textarea
                          {...fieldAria('event-description', error)}
                          rows={4}
                          maxLength={EVENT_LIMITS.description}
                          placeholder="Подробности, требования и место сбора"
                          value={field.state.value}
                          onChange={(change) =>
                            field.handleChange(change.target.value)
                          }
                          onBlur={field.handleBlur}
                        />
                      </FormField>
                    )
                  }}
                </form.Field>
              </div>
            )
          }}
        </form.Subscribe>
        <p className="m-0 text-xs text-muted-foreground">
          Дата и время указываются по московскому времени и одинаково
          показываются всем участникам.
        </p>
        <FormError message={formErrorMessage(serverError)} />
        <div className="flex flex-wrap gap-2 max-xs:grid max-xs:grid-cols-1">
          <Button type="submit" disabled={pending}>
            {event
              ? pending
                ? 'Сохраняем…'
                : 'Сохранить изменения'
              : pending
                ? 'Создаём…'
                : 'Создать событие'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={saveTemplate.isPending}
            onClick={() => void saveAsTemplate()}
          >
            {saveTemplate.isPending ? 'Сохраняем…' : 'Сохранить как шаблон'}
          </Button>
          {event ? (
            <Link
              to="/events/$id"
              params={{ id: event.id }}
              className={cn(linkButtonClass, 'self-center text-center')}
            >
              Отменить редактирование
            </Link>
          ) : (
            <Link
              to="/events"
              search={{ tab: 'active' }}
              className={cn(linkButtonClass, 'self-center text-center')}
            >
              Отмена
            </Link>
          )}
        </div>
      </form>
      {dialog}
    </Card>
  )
}

/** Создание события и библиотека шаблонов (EVT-03, EVT-11–13). */
export function CreateEventPage() {
  // Применённый шаблон пересоздаёт форму с его значениями.
  const [fill, setFill] = useState<{ key: number; fields: EventFields } | null>(
    null,
  )
  return (
    <section className="mx-auto w-full max-w-[860px]">
      <BackLink />
      <PageHeader
        title="Создать событие"
        description="Заполните основные сведения о событии."
      />
      <div className="grid gap-4">
        <EventForm key={fill?.key ?? 0} initial={fill?.fields} />
        <TemplateLibrary
          onApply={(fields) =>
            setFill((current) => ({ key: (current?.key ?? 0) + 1, fields }))
          }
        />
      </div>
    </section>
  )
}

/** Правка события: те же поля, отдельная отмена (EVT-03, EVT-07). */
export function EditEventPage({ id }: { id: string }) {
  const event = useEvent(id)

  let content
  if (event.isPending) {
    content = <LoadingState label="Загружаем событие…" />
  } else if (event.isError) {
    content =
      event.error.code === 'not_found' ? (
        <ErrorState
          title="Событие не найдено"
          message="Возможно, его удалили или ссылка устарела."
        />
      ) : (
        <ErrorState onRetry={() => void event.refetch()} />
      )
  } else if (!event.data.canManage) {
    content = (
      <ErrorState
        title="Редактирование недоступно"
        message="Событие правит автор-офицер или администратор; закрытое событие не меняется."
      />
    )
  } else {
    content = <EventForm event={event.data} />
  }

  return (
    <section className="mx-auto w-full max-w-[860px]">
      <BackLink />
      <PageHeader title="Редактировать событие" />
      <div className="grid gap-4">{content}</div>
    </section>
  )
}
