import { useState } from 'react'
import { useForm, useStore } from '@tanstack/react-form'
import { z } from 'zod'
import type { ActivitySummaryRow, RatingRow } from '@contracts/activity'
import { focusFirstInvalid } from '@/components/form/focus-first-invalid'
import { FormError } from '@/components/form/form-error'
import { FormField, fieldAria, fieldError } from '@/components/form/form-field'
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
import { toast } from '@/components/ui/toaster'
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard'
import { formErrorMessage, type AppError } from '@/lib/errors'
import { useCorrectActivityRating, useCorrectActivitySummary } from './api'

const numberField = z
  .number()
  .int('invalid_number')
  .min(0, 'invalid_number')
  .max(2_147_483_647, 'invalid_number')
const formSchema = z.object({
  visited: numberField,
  missed: numberField,
  unmarked: numberField,
  leaderCount: numberField,
  daysInGuild: numberField,
})

type CorrectionValues = z.input<typeof formSchema>

type CorrectionProps =
  | {
      kind: 'summary'
      row: ActivitySummaryRow
      onClose: () => void
    }
  | {
      kind: 'rating'
      row: RatingRow
      onClose: () => void
    }

/** Общая форма точных чисел для рейтинга и сводки (ACT-21–23). */
export function ActivityCorrectionDialog(props: CorrectionProps) {
  const summarySave = useCorrectActivitySummary()
  const ratingSave = useCorrectActivityRating()
  const save = props.kind === 'summary' ? summarySave : ratingSave
  const [serverError, setServerError] = useState<AppError | null>(null)
  const defaultValues: CorrectionValues = {
    visited: props.row.visited,
    missed: props.row.missed,
    unmarked: props.row.unmarked,
    leaderCount: props.kind === 'rating' ? props.row.leaderCount : 0,
    daysInGuild: props.kind === 'rating' ? (props.row.daysInGuild ?? 0) : 0,
  }
  const form = useCorrectionForm(defaultValues, async ({ value }) => {
    setServerError(null)
    const input = formSchema.parse(value)
    try {
      if (props.kind === 'summary') {
        await summarySave.mutateAsync({
          userId: props.row.userId,
          visited: input.visited,
          missed: input.missed,
          unmarked: input.unmarked,
        })
      } else {
        await ratingSave.mutateAsync({
          userId: props.row.userId,
          visited: input.visited,
          missed: input.missed,
          unmarked: input.unmarked,
          leaderCount: input.leaderCount,
          daysInGuild: input.daysInGuild,
        })
      }
      toast('Корректировка сохранена')
      props.onClose()
    } catch (error) {
      setServerError(error as AppError)
    }
  })
  const isDirty = useStore(form.store, (state) => state.isDirty)
  const { dialog } = useUnsavedChangesGuard(isDirty)
  const pending = save.isPending
  const label = props.kind === 'summary' ? 'сводки активности' : 'рейтинга'

  function close() {
    if (!pending) {
      props.onClose()
    }
  }

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) {
            close()
          }
        }}
      >
        <DialogContent className="w-[min(calc(100vw-28px),560px)]">
          <form
            noValidate
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              void form.handleSubmit()
            }}
          >
            <DialogHeader>
              <DialogTitle>Корректировка {label}</DialogTitle>
              <DialogDescription>
                Участник: {props.row.gameNickname}. Введите итоговые числа.
                Процент пересчитается автоматически.
              </DialogDescription>
            </DialogHeader>
            <form.Subscribe selector={(state) => state.submissionAttempts > 0}>
              {(submitted) => (
                <div className="grid gap-3 sm:grid-cols-2">
                  <NumberInput
                    name="visited"
                    label="Посетил"
                    form={form}
                    submitted={submitted}
                    serverError={serverError}
                    clearServerError={() => setServerError(null)}
                  />
                  <NumberInput
                    name="missed"
                    label="Не посетил"
                    form={form}
                    submitted={submitted}
                    serverError={serverError}
                    clearServerError={() => setServerError(null)}
                  />
                  <NumberInput
                    name="unmarked"
                    label="Не отметился"
                    form={form}
                    submitted={submitted}
                    serverError={serverError}
                    clearServerError={() => setServerError(null)}
                  />
                  {props.kind === 'rating' ? (
                    <>
                      <NumberInput
                        name="leaderCount"
                        label="Пати-лидерство"
                        form={form}
                        submitted={submitted}
                        serverError={serverError}
                        clearServerError={() => setServerError(null)}
                      />
                      <NumberInput
                        name="daysInGuild"
                        label="Дней в клане"
                        hint={
                          props.row.daysInGuild === null
                            ? 'Дата вступления неизвестна; здесь можно задать число.'
                            : undefined
                        }
                        form={form}
                        submitted={submitted}
                        serverError={serverError}
                        clearServerError={() => setServerError(null)}
                      />
                    </>
                  ) : null}
                </div>
              )}
            </form.Subscribe>
            <FormError message={formErrorMessage(serverError)} />
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={close}
              >
                Отмена
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? 'Сохраняем…' : 'Сохранить'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {dialog}
    </>
  )
}

type NumberName = keyof z.input<typeof formSchema>

function useCorrectionForm(
  defaultValues: CorrectionValues,
  onSubmit: (input: { value: CorrectionValues }) => Promise<void>,
) {
  return useForm({
    defaultValues,
    validators: { onChange: formSchema },
    onSubmitInvalid: focusFirstInvalid,
    onSubmit,
  })
}

type CorrectionFormApi = ReturnType<typeof useCorrectionForm>

function NumberInput({
  name,
  label,
  hint,
  form,
  submitted,
  serverError,
  clearServerError,
}: {
  name: NumberName
  label: string
  hint?: string | undefined
  form: CorrectionFormApi
  submitted: boolean
  serverError: AppError | null
  clearServerError: () => void
}) {
  return (
    <form.Field name={name}>
      {(field) => {
        const error = fieldError(
          field.state.meta,
          submitted,
          serverError?.fields[name],
        )
        return (
          <FormField
            id={`activity-correction-${name}`}
            label={label}
            error={error}
            hint={hint}
          >
            <Input
              {...fieldAria(`activity-correction-${name}`, error, hint)}
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={String(field.state.value)}
              onChange={(event) => {
                clearServerError()
                field.handleChange(event.currentTarget.valueAsNumber)
              }}
              onBlur={field.handleBlur}
            />
          </FormField>
        )
      }}
    </form.Field>
  )
}
