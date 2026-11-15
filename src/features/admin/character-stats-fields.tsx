import { useForm, useStore } from '@tanstack/react-form'
import { z } from 'zod'
import type { AccountCard } from '@contracts/accounts'
import {
  CHARACTER_STAT_FIELDS,
  CHARACTER_STAT_LABELS,
  isCharacterStatNumber,
  type CharacterStatField,
} from '@contracts/character-stats'
import { FormError } from '@/components/form/form-error'
import { FormField, fieldAria, fieldError } from '@/components/form/form-field'
import { focusFirstInvalid } from '@/components/form/focus-first-invalid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toaster'
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard'
import { formErrorMessage } from '@/lib/errors'
import { useSetCharacterStats } from './api'

const FIELDS: CharacterStatField[] = [...CHARACTER_STAT_FIELDS, 'source']

const statNumber = z
  .string()
  .max(64, 'too_long')
  .refine(
    (value) => value.trim() === '' || isCharacterStatNumber(value),
    'invalid_number',
  )

const statsSchema = z.object({
  pa: statNumber,
  pz: statNumber,
  bu: statNumber,
  hp: statNumber,
  bd: statNumber,
  source: z.string().max(160, 'too_long'),
})

type StatsValues = z.infer<typeof statsSchema>

function savedValues(stats: AccountCard): StatsValues {
  const text = (value: number | null | undefined) =>
    value === null || value === undefined ? '' : String(value)
  return {
    pa: text(stats.pa),
    pz: text(stats.pz),
    bu: text(stats.bu),
    hp: text(stats.hp),
    bd: text(stats.bd),
    source: stats.characterStatsSource ?? '',
  }
}

/**
 * Блок «Характеристика персонажа» карточки аккаунта (ADM-15): все поля
 * сохраняются одной кнопкой, одна запись журнала на сохранение.
 */
export function CharacterStatsFields({
  accountId,
  stats,
}: {
  accountId: string
  stats: AccountCard
}) {
  const save = useSetCharacterStats()
  const form = useForm({
    defaultValues: savedValues(stats),
    validators: { onChange: statsSchema },
    onSubmitInvalid: focusFirstInvalid,
    onSubmit: async ({ value }) => {
      const blank = (text: string) => text.trim() || null
      await save
        .mutateAsync({
          userId: accountId,
          pa: blank(value.pa),
          pz: blank(value.pz),
          bu: blank(value.bu),
          hp: blank(value.hp),
          bd: blank(value.bd),
          source: blank(value.source),
        })
        .then((result) => {
          form.reset(savedValues({ ...stats, ...result }))
          toast('Характеристика сохранена')
        })
        .catch(focusFirstInvalid)
    },
  })
  const isDirty = useStore(form.store, (state) => state.isDirty)
  const { dialog } = useUnsavedChangesGuard(isDirty || save.isPending)

  return (
    <details className="rounded-xl border border-border bg-surface-inset p-4">
      <summary className="cursor-pointer font-semibold">
        Характеристика персонажа
      </summary>
      <form
        noValidate
        className="mt-4 grid grid-cols-2 gap-3 max-[520px]:grid-cols-1"
        onSubmit={(event) => {
          event.preventDefault()
          void form.handleSubmit()
        }}
      >
        <form.Subscribe selector={(state) => state.submissionAttempts > 0}>
          {(submitted) =>
            FIELDS.map((name) => (
              <form.Field key={name} name={name}>
                {(field) => {
                  const error = fieldError(
                    field.state.meta,
                    submitted,
                    save.error?.fields[name],
                  )
                  const hint =
                    name === 'source'
                      ? 'До 160 символов.'
                      : 'Число; суффикс «к» означает тысячу.'
                  const id = `character-stat-${accountId}-${name}`
                  return (
                    <FormField
                      id={id}
                      label={CHARACTER_STAT_LABELS[name]}
                      error={error}
                      hint={hint}
                      {...(name === 'source'
                        ? { className: 'col-span-full' }
                        : {})}
                    >
                      <Input
                        {...fieldAria(id, error, hint)}
                        maxLength={name === 'source' ? 160 : 64}
                        inputMode={name === 'source' ? undefined : 'decimal'}
                        value={field.state.value}
                        disabled={save.isPending}
                        onChange={(event) => {
                          save.reset()
                          field.handleChange(event.target.value)
                        }}
                        onBlur={field.handleBlur}
                      />
                    </FormField>
                  )
                }}
              </form.Field>
            ))
          }
        </form.Subscribe>
        <div className="col-span-full grid gap-2">
          <FormError
            message={
              save.error && Object.keys(save.error.fields).length === 0
                ? formErrorMessage(save.error)
                : null
            }
          />
          <Button
            type="submit"
            className="justify-self-start max-[520px]:justify-self-stretch"
            disabled={!isDirty || save.isPending}
          >
            {save.isPending ? 'Сохраняем…' : 'Сохранить'}
          </Button>
        </div>
      </form>
      {dialog}
    </details>
  )
}
