import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useForm, useStore } from '@tanstack/react-form'
import { Eye, PenLine } from 'lucide-react'
import { z } from 'zod'
import { MATERIAL_LIMITS, type MaterialStatus } from '@contracts/materials'
import {
  EMPTY_DOCUMENT,
  hasMeaningfulContent,
  richDocumentSchema,
  type RichDocument,
} from '@contracts/rich-text'
import { focusFirstInvalid } from '@/components/form/focus-first-invalid'
import { FormError } from '@/components/form/form-error'
import {
  FormField,
  fieldAria,
  fieldError,
  formLabelClass,
} from '@/components/form/form-field'
import { EmptyState } from '@/components/states/empty-state'
import { ErrorState } from '@/components/states/error-state'
import { LoadingState } from '@/components/states/loading-state'
import { PageHeader } from '@/components/states/page-header'
import { Button, linkButtonClass } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Card, Notice } from '@/components/ui/surfaces'
import { toast } from '@/components/ui/toaster'
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard'
import { formErrorMessage, type AppError } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { AttachmentsField, type DraftAttachment } from './attachments-field'
import { LazyRichTextEditor } from './lazy-editor'
import { BackToFeed, MaterialContent } from './material-page'
import {
  discardPublicationUploads,
  useMaterial,
  useSaveMaterial,
  type MaterialView,
} from './materials-api'
import type { MaterialSection } from './section'

type EditorValues = {
  category: string
  title: string
  summary: string
  /** Документ Tiptap; `unknown`, чтобы типы формы не разворачивали рекурсию. */
  content: unknown
  attachments: DraftAttachment[]
  showAuthor: boolean
  discussionEnabled: boolean
}

/** Проверка формы: те же правила, что у сервера (PUB-03, PUB-12). */
function editorSchema(section: MaterialSection) {
  return z
    .object({
      category: z
        .string()
        .refine((value) => section.categories.includes(value), 'required'),
      title: z
        .string()
        .trim()
        .min(1, 'required')
        .max(MATERIAL_LIMITS.title, 'too_long'),
      summary: z.string().trim().max(MATERIAL_LIMITS.summary, 'too_long'),
      content: z.unknown(),
      attachments: z.custom<DraftAttachment[]>((value) => Array.isArray(value)),
      showAuthor: z.boolean(),
      discussionEnabled: z.boolean(),
    })
    .superRefine((value, ctx) => {
      const parsed = richDocumentSchema.safeParse(value.content)
      if (!parsed.success) {
        ctx.addIssue({
          code: 'custom',
          path: ['content'],
          message: parsed.error.issues[0]?.message ?? 'invalid',
        })
      } else if (
        !hasMeaningfulContent(parsed.data) &&
        value.attachments.length === 0
      ) {
        ctx.addIssue({ code: 'custom', path: ['content'], message: 'empty' })
      }
    })
}

function initialValues(
  section: MaterialSection,
  material: MaterialView | undefined,
): EditorValues {
  return material
    ? {
        category: material.category,
        title: material.title,
        summary: material.summary ?? '',
        content: material.content,
        attachments: material.attachments ?? [],
        showAuthor: material.showAuthor ?? true,
        discussionEnabled: material.discussionEnabled,
      }
    : {
        category: section.categories[0] ?? '',
        title: '',
        summary: '',
        content: EMPTY_DOCUMENT,
        attachments: [],
        showAuthor: true,
        discussionEnabled: false,
      }
}

const checkboxClass =
  'flex cursor-pointer items-center gap-2 text-sm text-foreground [&>input]:size-4 [&>input]:accent-primary'

/**
 * Редактор материала (PUB-02–PUB-06, MKT-03/04): поля, содержимое,
 * вложения, предпросмотр без сохранения, «Сохранить черновик» и
 * «Опубликовать», защита от ухода с несохранёнными изменениями (Q-17).
 */
function MaterialEditor({
  section,
  material,
}: {
  section: MaterialSection
  material?: MaterialView
}) {
  const navigate = useNavigate()
  const save = useSaveMaterial(section)
  const [preview, setPreview] = useState(false)
  const [serverError, setServerError] = useState<AppError | null>(null)
  const status = useRef<MaterialStatus>('draft')
  // Какой кнопкой отправлено — для подписи «Публикуем…» / «Сохраняем…».
  const [submitting, setSubmitting] = useState<MaterialStatus>('draft')
  // Загруженные в этом редакторе файлы; не сохранённые удаляются при уходе.
  const uploads = useRef(new Set<string>())
  const saved = useRef(false)
  // Версия, открытая в редакторе: фоновое обновление её не подменяет.
  const baseVersion = useRef(material?.updatedAt ?? null)
  const schema = editorSchema(section)

  useEffect(
    () => () => {
      if (!saved.current) {
        void discardPublicationUploads([...uploads.current])
      }
    },
    [],
  )

  const form = useForm({
    defaultValues: initialValues(section, material),
    validators: { onChange: schema },
    onSubmitInvalid: () => {
      setPreview(false)
      focusFirstInvalid()
    },
    onSubmit: async ({ value }) => {
      setServerError(null)
      try {
        const result = await save.mutateAsync({
          id: material?.id ?? null,
          expectedUpdatedAt: baseVersion.current,
          status: status.current,
          category: value.category,
          title: value.title.trim(),
          summary: value.summary.trim() || null,
          content: value.content as RichDocument,
          discussionEnabled: value.discussionEnabled,
          ...(section.withAuthorToggle ? { showAuthor: value.showAuthor } : {}),
          ...(section.withFiles
            ? {
                attachments: value.attachments.map((file) => ({
                  path: file.path,
                  fileName: file.fileName,
                })),
              }
            : {}),
        })
        saved.current = true
        // Убранные из списка новые файлы сервер не привяжет: удаляем их.
        const kept = new Set(value.attachments.map((file) => file.path))
        void discardPublicationUploads(
          [...uploads.current].filter((path) => !kept.has(path)),
        )
        toast(
          status.current === 'published' ? 'Опубликовано' : 'Черновик сохранён',
        )
        await navigate({
          to: `${section.path}/$id`,
          params: { id: result.id },
          ignoreBlocker: true,
        })
      } catch (error) {
        setServerError(error as AppError)
        setPreview(false)
        focusFirstInvalid()
      }
    },
  })

  const isDirty = useStore(form.store, (state) => state.isDirty)
  const { dialog } = useUnsavedChangesGuard(isDirty)
  const values = useStore(form.store, (state) => state.values)
  const serverFields = serverError?.fields ?? {}
  const pending = save.isPending
  const published = material?.status === 'published'

  const submitAs = (next: MaterialStatus) => {
    status.current = next
    setSubmitting(next)
    void form.handleSubmit()
  }

  const categoryOptions = section.categories.map((value) => ({
    value,
    label: section.categoryLabels[value] ?? value,
  }))

  return (
    <Card className="grid gap-4 p-4 sm:p-6">
      <fieldset className="m-0 flex flex-wrap gap-2 border-0 p-0 max-xs:grid max-xs:grid-cols-2">
        <legend className="sr-only">Режим</legend>
        <Button
          type="button"
          variant={preview ? 'secondary' : 'default'}
          aria-pressed={!preview}
          onClick={() => setPreview(false)}
        >
          <PenLine aria-hidden className="size-4" /> Редактирование
        </Button>
        <Button
          type="button"
          variant={preview ? 'default' : 'secondary'}
          aria-pressed={preview}
          onClick={() => setPreview(true)}
        >
          <Eye aria-hidden className="size-4" /> Предпросмотр
        </Button>
      </fieldset>

      {preview ? (
        <div className="grid gap-3">
          <Notice>
            Так материал увидят читатели. Предпросмотр ничего не сохраняет.
          </Notice>
          <MaterialContent
            section={section}
            material={{
              category: values.category,
              title: values.title || 'Без заголовка',
              summary: values.summary.trim() || null,
              content: values.content as RichDocument,
              attachments: values.attachments,
              status: published ? 'published' : 'draft',
            }}
          />
        </div>
      ) : null}

      <form
        noValidate
        aria-label={material ? section.texts.editTitle : section.texts.newTitle}
        className={cn('grid gap-4', preview && 'hidden')}
        onSubmit={(event) => {
          event.preventDefault()
          submitAs(published ? 'published' : 'draft')
        }}
      >
        <form.Subscribe selector={(state) => state.submissionAttempts > 0}>
          {(submitted) => (
            <div className="grid gap-4 sm:grid-cols-[220px_minmax(0,1fr)]">
              <form.Field name="category">
                {(field) => {
                  const error = fieldError(
                    field.state.meta,
                    submitted,
                    serverFields.category,
                  )
                  return (
                    <FormField
                      id="material-category"
                      label="Категория"
                      error={error}
                    >
                      <Select
                        {...fieldAria('material-category', error)}
                        options={categoryOptions}
                        value={field.state.value}
                        onValueChange={field.handleChange}
                      />
                    </FormField>
                  )
                }}
              </form.Field>
              <form.Field name="title">
                {(field) => {
                  const error = fieldError(
                    field.state.meta,
                    submitted,
                    serverFields.title,
                  )
                  return (
                    <FormField
                      id="material-title"
                      label="Заголовок"
                      error={error}
                    >
                      <Input
                        {...fieldAria('material-title', error)}
                        maxLength={MATERIAL_LIMITS.title}
                        value={field.state.value}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                        onBlur={field.handleBlur}
                      />
                    </FormField>
                  )
                }}
              </form.Field>
              <form.Field name="summary">
                {(field) => {
                  const error = fieldError(
                    field.state.meta,
                    submitted,
                    serverFields.summary,
                  )
                  return (
                    <FormField
                      id="material-summary"
                      label="Анонс (необязательно)"
                      hint="Короткое описание для карточки в ленте."
                      error={error}
                      className="col-span-full"
                    >
                      <Textarea
                        {...fieldAria('material-summary', error, true)}
                        rows={2}
                        maxLength={MATERIAL_LIMITS.summary}
                        value={field.state.value}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                        onBlur={field.handleBlur}
                      />
                    </FormField>
                  )
                }}
              </form.Field>
              <form.Field name="content">
                {(field) => {
                  const error = fieldError(
                    field.state.meta,
                    submitted,
                    serverFields.content,
                  )
                  return (
                    <div className="col-span-full grid gap-2">
                      <span
                        id="material-content-label"
                        className={formLabelClass}
                      >
                        Содержимое
                      </span>
                      <LazyRichTextEditor
                        id="material-content"
                        label="Содержимое"
                        value={field.state.value as RichDocument}
                        onChange={field.handleChange}
                        onBlur={field.handleBlur}
                        invalid={Boolean(error)}
                        {...(error
                          ? { describedBy: 'material-content-error' }
                          : {})}
                      />
                      {/* Строка ошибки зарезервирована: когда ошибка
                          исчезает при вводе, кнопки под редактором не
                          сдвигаются из-под курсора. */}
                      <small
                        id="material-content-error"
                        className="min-h-lh text-xs text-destructive"
                      >
                        {error}
                      </small>
                    </div>
                  )
                }}
              </form.Field>
              {section.withFiles ? (
                <form.Field name="attachments">
                  {(field) => (
                    <div className="col-span-full grid gap-2">
                      <label
                        htmlFor="material-files"
                        className={formLabelClass}
                      >
                        Вложения
                      </label>
                      <AttachmentsField
                        id="material-files"
                        value={field.state.value}
                        onChange={field.handleChange}
                        onUploaded={(path) => uploads.current.add(path)}
                      />
                    </div>
                  )}
                </form.Field>
              ) : null}
              <div className="col-span-full grid gap-2">
                {section.withAuthorToggle ? (
                  <form.Field name="showAuthor">
                    {(field) => (
                      <label className={checkboxClass}>
                        <input
                          type="checkbox"
                          checked={field.state.value}
                          onChange={(event) =>
                            field.handleChange(event.target.checked)
                          }
                        />
                        Показывать читателям подпись автора
                      </label>
                    )}
                  </form.Field>
                ) : null}
                <form.Field name="discussionEnabled">
                  {(field) => (
                    <label className={checkboxClass}>
                      <input
                        type="checkbox"
                        checked={field.state.value}
                        onChange={(event) =>
                          field.handleChange(event.target.checked)
                        }
                      />
                      Включить обсуждение
                    </label>
                  )}
                </form.Field>
              </div>
            </div>
          )}
        </form.Subscribe>
        {serverError?.code === 'state_conflict' ? (
          <Notice role="alert">
            Материал изменили, пока вы его редактировали.{' '}
            {material ? (
              <Link
                to={`${section.path}/$id`}
                params={{ id: material.id }}
                className={linkButtonClass}
              >
                Открыть актуальную версию
              </Link>
            ) : null}
          </Notice>
        ) : (
          <FormError message={formErrorMessage(serverError)} />
        )}
      </form>

      <div className="flex flex-wrap gap-2 max-xs:grid max-xs:grid-cols-1">
        <Button
          type="button"
          disabled={pending}
          onClick={() => submitAs('published')}
        >
          {pending && submitting === 'published'
            ? 'Публикуем…'
            : published
              ? 'Сохранить'
              : 'Опубликовать'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => submitAs('draft')}
        >
          {pending && submitting === 'draft'
            ? 'Сохраняем…'
            : published
              ? 'Сохранить как черновик'
              : 'Сохранить черновик'}
        </Button>
        <Link
          to={material ? `${section.path}/$id` : section.path}
          params={material ? { id: material.id } : {}}
          className={cn(linkButtonClass, 'self-center text-center')}
        >
          Отмена
        </Link>
      </div>
      {dialog}
    </Card>
  )
}

export function MaterialEditorPage({
  section,
  id,
}: {
  section: MaterialSection
  id?: string
}) {
  return (
    <section className="grid gap-2">
      <div>
        <BackToFeed section={section} />
      </div>
      <PageHeader
        eyebrow={section.texts.title}
        title={id ? section.texts.editTitle : section.texts.newTitle}
      />
      {id ? (
        <ExistingMaterialEditor section={section} id={id} />
      ) : (
        <MaterialEditor section={section} />
      )}
    </section>
  )
}

function ExistingMaterialEditor({
  section,
  id,
}: {
  section: MaterialSection
  id: string
}) {
  const material = useMaterial(section, id)
  if (material.isPending) {
    return <LoadingState label="Загружаем материал…" />
  }
  if (material.isError) {
    return <ErrorState onRetry={() => void material.refetch()} />
  }
  if (!material.data.canManage) {
    return (
      <EmptyState
        title="Нет прав на правку"
        description={`Изменять ${section.texts.item} может автор или администратор.`}
      />
    )
  }
  return <MaterialEditor section={section} material={material.data} />
}
