import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useForm, useStore } from '@tanstack/react-form'
import { ArrowLeft, Plus, X } from 'lucide-react'
import { z } from 'zod'
import { createVoteSchema, VOTE_LIMITS } from '@contracts/votes'
import { focusFirstInvalid } from '@/components/form/focus-first-invalid'
import { FormError } from '@/components/form/form-error'
import {
  FormField,
  fieldAria,
  fieldError,
  fieldErrorClass,
  fieldHintClass,
  formLabelClass,
} from '@/components/form/form-field'
import { PageHeader } from '@/components/states/page-header'
import { Button, linkButtonClass } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Card, fieldClass } from '@/components/ui/surfaces'
import { toast } from '@/components/ui/toaster'
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard'
import { fieldMessage, formErrorMessage, type AppError } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { useCreateVote } from './api'

/** Схема формы: контекст в поле — всегда строка (пустая — без контекста). */
const formSchema = createVoteSchema.extend({
  context: z.string().trim().max(VOTE_LIMITS.context, 'too_long'),
})

type OptionsEditorProps = {
  options: string[]
  errors: (string | null)[]
  onChange: (options: string[]) => void
}

/** 2–10 вариантов: удалить нельзя при двух, добавить — при десяти (VOT-03). */
function OptionsEditor({ options, errors, onChange }: OptionsEditorProps) {
  const canRemove = options.length > VOTE_LIMITS.optionsMin
  return (
    <div className="grid gap-2">
      <small id="vote-options-hint" className={fieldHintClass}>
        От {VOTE_LIMITS.optionsMin} до {VOTE_LIMITS.optionsMax} вариантов, до{' '}
        {VOTE_LIMITS.option} символов. Варианты не должны повторяться.
      </small>
      {options.map((option, index) => {
        const id = `vote-option-${index}`
        const error = errors[index]
        return (
          <div
            key={index}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2"
          >
            <Input
              {...fieldAria(id, error)}
              aria-label={`Вариант ${index + 1}`}
              maxLength={VOTE_LIMITS.option}
              value={option}
              onChange={(event) =>
                onChange(
                  options.map((item, i) =>
                    i === index ? event.target.value : item,
                  ),
                )
              }
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Удалить вариант ${index + 1}`}
              disabled={!canRemove}
              onClick={() => onChange(options.filter((_, i) => i !== index))}
            >
              <X size={18} aria-hidden="true" />
            </Button>
            {error ? (
              <small
                id={`${id}-error`}
                className={cn(fieldErrorClass, 'col-span-full')}
              >
                {error}
              </small>
            ) : null}
          </div>
        )
      })}
      {options.length < VOTE_LIMITS.optionsMax ? (
        <Button
          type="button"
          variant="secondary"
          className="justify-self-start"
          onClick={() => onChange([...options, ''])}
        >
          <Plus size={18} aria-hidden="true" /> Добавить вариант
        </Button>
      ) : null}
    </div>
  )
}

/** Создание обычного голосования (VOT-02, VOT-03); офицер и администратор. */
export function CreateVotePage() {
  const navigate = useNavigate()
  const create = useCreateVote()
  const [serverError, setServerError] = useState<AppError | null>(null)

  const form = useForm({
    defaultValues: { title: '', context: '', options: ['', ''] },
    validators: { onChange: formSchema },
    onSubmitInvalid: focusFirstInvalid,
    onSubmit: async ({ value }) => {
      setServerError(null)
      await create
        .mutateAsync(formSchema.parse(value))
        .then(async (vote) => {
          toast('Голосование создано')
          await navigate({
            to: '/votes/$id',
            params: { id: vote.id },
            ignoreBlocker: true,
          })
        })
        .catch((error: AppError) => {
          setServerError(error)
          focusFirstInvalid()
        })
    },
  })

  const isDirty = useStore(form.store, (state) => state.isDirty)
  const { dialog } = useUnsavedChangesGuard(isDirty)
  const serverFields = serverError?.fields ?? {}

  return (
    <section className="mx-auto w-full max-w-[620px]">
      <Link
        to="/votes"
        search={{ tab: 'active' }}
        className={cn(linkButtonClass, 'mb-3 inline-flex items-center gap-1.5')}
      >
        <ArrowLeft size={16} aria-hidden="true" /> К голосованиям
      </Link>
      <PageHeader eyebrow="Клан" title="Новое голосование" />
      <Card>
        <form
          noValidate
          aria-label="Новое голосование"
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void form.handleSubmit()
          }}
        >
          <form.Subscribe selector={(state) => state.submissionAttempts > 0}>
            {(submitted) => (
              <>
                <form.Field name="title">
                  {(field) => {
                    const error = fieldError(
                      field.state.meta,
                      submitted,
                      serverFields.title,
                    )
                    return (
                      <FormField id="vote-title" label="Тема" error={error}>
                        <Input
                          {...fieldAria('vote-title', error)}
                          maxLength={VOTE_LIMITS.title}
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
                <form.Field name="context">
                  {(field) => {
                    const error = fieldError(
                      field.state.meta,
                      submitted,
                      serverFields.context,
                    )
                    const hint = `Необязательно, до ${VOTE_LIMITS.context} символов.`
                    return (
                      <FormField
                        id="vote-context"
                        label="Контекст"
                        hint={hint}
                        error={error}
                      >
                        <Textarea
                          {...fieldAria('vote-context', error, hint)}
                          rows={4}
                          maxLength={VOTE_LIMITS.context}
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
                <form.Field name="options">
                  {(field) => {
                    const errors = field.state.value.map((_option, index) => {
                      const server = serverFields[`options.${index}`]
                      if (server) {
                        return fieldMessage(server)
                      }
                      if (!submitted) {
                        return null
                      }
                      const meta = form.getFieldMeta(`options[${index}]`)
                      const issue = meta?.errors.find(Boolean) as
                        { message?: string } | string | undefined
                      const message =
                        typeof issue === 'string' ? issue : issue?.message
                      return message ? fieldMessage(message) : null
                    })
                    return (
                      <fieldset className={cn(fieldClass, 'm-0 border-0 p-0')}>
                        <legend className={cn(formLabelClass, 'mb-2')}>
                          Варианты
                        </legend>
                        <OptionsEditor
                          options={field.state.value}
                          errors={errors}
                          onChange={(options) => {
                            setServerError(null)
                            field.handleChange(options)
                          }}
                        />
                      </fieldset>
                    )
                  }}
                </form.Field>
              </>
            )}
          </form.Subscribe>
          <FormError message={formErrorMessage(serverError)} />
          <div className="flex flex-wrap gap-2 max-xs:grid max-xs:grid-cols-1">
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Создаём…' : 'Создать голосование'}
            </Button>
            <Link
              to="/votes"
              search={{ tab: 'active' }}
              className={cn(linkButtonClass, 'self-center text-center')}
            >
              Отмена
            </Link>
          </div>
        </form>
      </Card>
      {dialog}
    </section>
  )
}
