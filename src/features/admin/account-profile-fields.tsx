import { useEffect, useState } from 'react'
import { useForm, useStore } from '@tanstack/react-form'
import { z } from 'zod'
import type { AccountCard } from '@contracts/accounts'
import { gameNicknameSchema, classIdSchema } from '@contracts/account'
import { ROLE_LABELS } from '@/app/access'
import { focusFirstInvalid } from '@/components/form/focus-first-invalid'
import { FormError } from '@/components/form/form-error'
import { FormField, fieldAria, fieldError } from '@/components/form/form-field'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toaster'
import { ClassSelect } from '@/features/catalog/class-select'
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard'
import { formErrorMessage } from '@/lib/errors'
import { useSetAccountProfile } from './api'

const profileSchema = z.object({
  gameNickname: gameNicknameSchema,
  classId: classIdSchema,
})

/** Правка ника и класса администратором в карточке аккаунта (ADM-16). */
export function AccountProfileFields({
  account,
  onDirtyChange,
  onSavingChange,
  onSaveComplete,
}: {
  account: AccountCard
  onDirtyChange: (dirty: boolean) => void
  onSavingChange: (saving: boolean) => void
  onSaveComplete: () => void
}) {
  const save = useSetAccountProfile()
  const [editing, setEditing] = useState(false)
  const form = useForm({
    defaultValues: {
      gameNickname: account.gameNickname,
      classId: account.classId,
    },
    validators: { onChange: profileSchema },
    onSubmitInvalid: focusFirstInvalid,
    onSubmit: async ({ value }) => {
      await save
        .mutateAsync({
          userId: account.id,
          gameNickname: value.gameNickname.trim(),
          classId: value.classId,
        })
        .then(() => {
          form.reset(value)
          setEditing(false)
          onSaveComplete()
          toast('Профиль сохранён')
        })
        .catch(focusFirstInvalid)
    },
  })
  const isDirty = useStore(form.store, (state) => state.isDirty)
  const { dialog } = useUnsavedChangesGuard(
    editing && (isDirty || save.isPending),
  )

  useEffect(() => {
    onDirtyChange(editing && (isDirty || save.isPending))
    return () => onDirtyChange(false)
  }, [editing, isDirty, onDirtyChange, save.isPending])

  useEffect(() => {
    onSavingChange(save.isPending)
    return () => onSavingChange(false)
  }, [onSavingChange, save.isPending])

  if (!editing) {
    return (
      <section className="grid min-w-0 gap-3">
        <div className="flex items-center gap-3">
          <Avatar
            size="md"
            name={account.gameNickname}
            src={account.avatarUrl}
            alt=""
          />
          <div className="grid min-w-0">
            <strong className="text-lg break-words">
              {account.gameNickname}
            </strong>
            <span className="text-sm text-muted-foreground">
              {ROLE_LABELS[account.role]}
              {account.isPrimaryAdmin ? ' · основной' : ''}
            </span>
          </div>
        </div>
        <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3 max-[520px]:grid-cols-1">
          <div className="grid gap-0.5">
            <dt className="text-xs text-muted-foreground">Класс</dt>
            <dd className="m-0 break-words">{account.className || '—'}</dd>
          </div>
        </dl>
        {!account.deletionPending ? (
          <Button
            type="button"
            variant="secondary"
            className="justify-self-start max-[520px]:justify-self-stretch"
            onClick={() => {
              save.reset()
              form.reset({
                gameNickname: account.gameNickname,
                classId: account.classId,
              })
              setEditing(true)
            }}
          >
            Изменить профиль
          </Button>
        ) : null}
      </section>
    )
  }

  return (
    <section
      aria-label="Изменение ника и класса"
      className="grid min-w-0 gap-3 rounded-xl border border-border bg-surface-inset p-4"
    >
      <form
        noValidate
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          void form.handleSubmit()
        }}
      >
        <form.Subscribe selector={(state) => state.submissionAttempts > 0}>
          {(submitted) => (
            <>
              <form.Field name="gameNickname">
                {(field) => {
                  const id = `account-profile-${account.id}-nickname`
                  const error = fieldError(
                    field.state.meta,
                    submitted,
                    save.error?.fields.gameNickname,
                  )
                  return (
                    <FormField id={id} label="Игровой ник" error={error}>
                      <Input
                        {...fieldAria(id, error)}
                        autoComplete="off"
                        maxLength={9}
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
              <form.Field name="classId">
                {(field) => {
                  const id = `account-profile-${account.id}-class`
                  const error = fieldError(
                    field.state.meta,
                    submitted,
                    save.error?.fields.classId,
                  )
                  return (
                    <FormField id={id} label="Класс" error={error}>
                      <ClassSelect
                        id={id}
                        value={field.state.value}
                        error={error}
                        onChange={(value) => {
                          save.reset()
                          field.handleChange(value)
                        }}
                      />
                    </FormField>
                  )
                }}
              </form.Field>
            </>
          )}
        </form.Subscribe>
        <FormError
          message={
            save.error && Object.keys(save.error.fields).length === 0
              ? formErrorMessage(save.error)
              : null
          }
        />
        <div className="flex flex-wrap gap-2 max-[520px]:grid">
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(submitting) => (
              <Button type="submit" disabled={!isDirty || submitting}>
                {submitting ? 'Сохраняем…' : 'Сохранить'}
              </Button>
            )}
          </form.Subscribe>
          <Button
            type="button"
            variant="ghost"
            disabled={save.isPending}
            onClick={() => {
              form.reset({
                gameNickname: account.gameNickname,
                classId: account.classId,
              })
              save.reset()
              setEditing(false)
            }}
          >
            Отмена
          </Button>
        </div>
      </form>
      {dialog}
    </section>
  )
}
