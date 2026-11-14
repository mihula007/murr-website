import { Link } from '@tanstack/react-router'
import { useForm, useStore } from '@tanstack/react-form'
import { useMutation } from '@tanstack/react-query'
import { z } from 'zod'
import { focusFirstInvalid } from '@/components/form/focus-first-invalid'
import { FormError } from '@/components/form/form-error'
import {
  FormField,
  fieldError,
  subformClass,
} from '@/components/form/form-field'
import { PasswordInput } from '@/components/form/password-input'
import { Button, linkButtonClass } from '@/components/ui/button'
import { toast } from '@/components/ui/toaster'
import { changePassword } from '@/features/auth/auth-api'
import { newPasswordSchema, PASSWORD_HINT } from '@/features/auth/schemas'
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard'
import { formErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'current_password_required'),
    newPassword: newPasswordSchema,
    repeatPassword: z.string(),
  })
  .refine((value) => value.repeatPassword === value.newPassword, {
    message: 'password_mismatch',
    path: ['repeatPassword'],
  })

type PasswordField = keyof z.input<typeof passwordSchema>

const FIELDS: {
  name: PasswordField
  id: string
  label: string
  autoComplete: 'current-password' | 'new-password'
  hint?: string
}[] = [
  {
    name: 'currentPassword',
    id: 'password-current',
    label: 'Текущий пароль',
    autoComplete: 'current-password',
  },
  {
    name: 'newPassword',
    id: 'password-next',
    label: 'Новый пароль',
    autoComplete: 'new-password',
    hint: PASSWORD_HINT,
  },
  {
    name: 'repeatPassword',
    id: 'password-repeat',
    label: 'Повторите новый пароль',
    autoComplete: 'new-password',
  },
]

/** Смена своего пароля (ACC-09, ACC-10); доступна и чтецу. Без аудита (Q-34). */
export function PasswordForm({
  email,
  onDone,
}: {
  email: string
  onDone: () => void
}) {
  const change = useMutation({
    mutationFn: changePassword,
    onSuccess: () => {
      form.reset()
      toast('Пароль изменён')
      onDone()
    },
  })

  const form = useForm({
    defaultValues: { currentPassword: '', newPassword: '', repeatPassword: '' },
    validators: { onChange: passwordSchema },
    onSubmitInvalid: focusFirstInvalid,
    onSubmit: async ({ value }) => {
      const input = passwordSchema.parse(value)
      await change
        .mutateAsync({
          email,
          currentPassword: input.currentPassword,
          newPassword: input.newPassword,
        })
        .catch(focusFirstInvalid)
    },
  })
  const isDirty = useStore(form.store, (state) => state.isDirty)
  const { dialog } = useUnsavedChangesGuard(isDirty)

  return (
    <form
      noValidate
      className={subformClass}
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <div>
        <h3 className="text-xl font-bold">Обновить пароль</h3>
        <p className="text-sm text-muted-foreground">
          Для защиты аккаунта сначала подтверди текущий пароль.
        </p>
      </div>
      <form.Subscribe selector={(state) => state.submissionAttempts > 0}>
        {(submitted) => (
          <div className="grid gap-3">
            {FIELDS.map(({ name, id, label, autoComplete, hint }) => (
              <form.Field key={name} name={name}>
                {(field) => {
                  const serverCode = change.error?.fields[name]
                  const error = fieldError(
                    field.state.meta,
                    submitted,
                    serverCode,
                  )
                  return (
                    <FormField id={id} label={label} error={error} hint={hint}>
                      <PasswordInput
                        id={id}
                        autoComplete={autoComplete}
                        value={field.state.value}
                        onChange={(value) => {
                          if (serverCode) {
                            change.reset()
                          }
                          field.handleChange(value)
                        }}
                        onBlur={field.handleBlur}
                        error={error}
                        hint={hint}
                      />
                    </FormField>
                  )
                }}
              </form.Field>
            ))}
          </div>
        )}
      </form.Subscribe>
      <FormError message={formErrorMessage(change.error)} />
      <div className="flex flex-wrap items-center gap-3">
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(submitting) => (
            <Button type="submit" size="sm" disabled={submitting}>
              {submitting ? 'Меняем…' : 'Изменить пароль'}
            </Button>
          )}
        </form.Subscribe>
        <Link
          to="/reset-password"
          search={{ email }}
          className={cn(linkButtonClass, 'text-sm')}
        >
          Забыли пароль?
        </Link>
      </div>
      {dialog}
    </form>
  )
}
