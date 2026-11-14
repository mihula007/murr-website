import { useState } from 'react'
import { useForm, useStore } from '@tanstack/react-form'
import { z } from 'zod'
import type { AccountCard } from '@contracts/accounts'
import {
  CHARACTER_STAT_FIELDS,
  CHARACTER_STAT_LABELS,
  type CharacterStatField,
} from '@contracts/character-stats'
import { FormField, fieldAria, fieldError } from '@/components/form/form-field'
import { focusFirstInvalid } from '@/components/form/focus-first-invalid'
import { Input } from '@/components/ui/input'
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard'
import { formErrorMessage } from '@/lib/errors'
import { useSetCharacterStat } from './api'

type CharacterStatsFieldsProps = {
  accountId: string
  stats: AccountCard
}

function savedInputValue(field: CharacterStatField, stats: AccountCard) {
  if (field === 'source') {
    return stats.characterStatsSource ?? ''
  }
  const value = stats[field]
  return value === null || value === undefined ? '' : String(value)
}

function CharacterStatInput({
  accountId,
  field,
  savedValue: initialValue,
}: {
  accountId: string
  field: CharacterStatField
  savedValue: string
}) {
  const [savedValue, setSavedValue] = useState(initialValue)
  const save = useSetCharacterStat()
  const schema = z.object({
    value: z.string().max(field === 'source' ? 160 : 64, 'too_long'),
  })
  const form = useForm({
    defaultValues: { value: initialValue },
    validators: { onChange: schema },
    onSubmitInvalid: focusFirstInvalid,
    onSubmit: async ({ value }) => {
      const nextValue = value.value.trim()
      if (nextValue === savedValue) {
        return
      }
      await save
        .mutateAsync({
          userId: accountId,
          field,
          value: nextValue || null,
        })
        .then(() => {
          setSavedValue(value.value)
          form.reset({ value: value.value })
        })
        .catch(() => undefined)
    },
  })
  const isDirty = useStore(form.store, (state) => state.isDirty)
  const { dialog } = useUnsavedChangesGuard(isDirty || save.isPending)

  return (
    <>
      <form.Subscribe selector={(state) => state.submissionAttempts > 0}>
        {(submitted) => (
          <form.Field name="value">
            {(fieldApi) => {
              const serverFieldError = save.error?.fields.value
              const validationError = fieldError(
                fieldApi.state.meta,
                submitted,
                serverFieldError,
              )
              const error =
                validationError ??
                (save.error && !serverFieldError
                  ? formErrorMessage(save.error)
                  : null)
              const hint =
                field === 'source'
                  ? 'До 160 символов.'
                  : 'Число; суффикс «к» означает тысячу.'
              const id = `character-stat-${accountId}-${field}`
              return (
                <FormField
                  id={id}
                  label={CHARACTER_STAT_LABELS[field]}
                  error={error}
                  hint={save.isPending ? 'Сохраняем…' : hint}
                  {...(field === 'source'
                    ? { className: 'col-span-full' }
                    : {})}
                >
                  <Input
                    {...fieldAria(id, error, hint)}
                    maxLength={field === 'source' ? 160 : 64}
                    inputMode={field === 'source' ? undefined : 'decimal'}
                    value={fieldApi.state.value}
                    disabled={save.isPending}
                    onChange={(event) => {
                      save.reset()
                      fieldApi.handleChange(event.target.value)
                    }}
                    onBlur={() => {
                      fieldApi.handleBlur()
                      if (
                        fieldApi.state.meta.errors.length === 0 &&
                        fieldApi.state.value !== savedValue
                      ) {
                        void form.handleSubmit()
                      }
                    }}
                  />
                </FormField>
              )
            }}
          </form.Field>
        )}
      </form.Subscribe>
      {dialog}
    </>
  )
}

/** Поля карточки аккаунта; каждое сохраняется отдельно при потере фокуса. */
export function CharacterStatsFields({
  accountId,
  stats,
}: CharacterStatsFieldsProps) {
  const fields: CharacterStatField[] = [...CHARACTER_STAT_FIELDS, 'source']
  return (
    <details className="rounded-xl border border-border bg-surface-inset p-4">
      <summary className="cursor-pointer font-semibold">
        Характеристика персонажа
      </summary>
      <div className="mt-4 grid grid-cols-2 gap-3 max-[520px]:grid-cols-1">
        {fields.map((field) => (
          <CharacterStatInput
            key={`${accountId}-${field}`}
            accountId={accountId}
            field={field}
            savedValue={savedInputValue(field, stats)}
          />
        ))}
      </div>
    </details>
  )
}
