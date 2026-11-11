import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useForm, useStore } from '@tanstack/react-form'
import { useMutation, type UseMutationResult } from '@tanstack/react-query'
import { z } from 'zod'
import { focusFirstInvalid } from '@/components/form/focus-first-invalid'
import { FormError } from '@/components/form/form-error'
import { FormField, fieldAria, fieldError } from '@/components/form/form-field'
import { PasswordInput } from '@/components/form/password-input'
import { Button, linkButtonClass } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toaster'
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard'
import { formErrorMessage, type AppError } from '@/lib/errors'
import { resetPassword, sendPasswordResetCode } from './auth-api'
import { AuthPage } from './auth-page'
import { OtpField, resendLabel, useCountdown } from './otp-field'
import {
  PASSWORD_HINT,
  emailSchema,
  newPasswordSchema,
  otpCodeSchema,
} from './schemas'

const emailStepSchema = z.object({ email: emailSchema })
const codeStepSchema = z
  .object({
    code: otpCodeSchema,
    password: newPasswordSchema,
    repeat: z.string(),
  })
  .refine((value) => value.repeat === value.password, {
    message: 'password_mismatch',
    path: ['repeat'],
  })

/** Восстановление пароля кодом из письма (ACC-11, Q-30), без redirect-ссылок. */
export function ResetPasswordPage({ email = '' }: { email?: string }) {
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [cooldown, startCooldown] = useCountdown()
  const sendCode = useMutation({
    mutationFn: sendPasswordResetCode,
    onSuccess: (_result, address) => {
      setSentTo(address)
      startCooldown()
    },
  })

  return (
    <AuthPage
      title="Восстановление пароля"
      description={
        sentTo
          ? `Если аккаунт с адресом ${sentTo} существует, мы отправили на него код.`
          : 'Укажи email аккаунта — пришлём код для смены пароля.'
      }
    >
      {sentTo ? (
        <CodeStep email={sentTo} cooldown={cooldown} resend={sendCode} />
      ) : (
        <EmailStep email={email} sendCode={sendCode} />
      )}
    </AuthPage>
  )
}

type SendCodeMutation = UseMutationResult<void, AppError, string>

function EmailStep({
  email,
  sendCode,
}: {
  email: string
  sendCode: SendCodeMutation
}) {
  const form = useForm({
    defaultValues: { email },
    validators: { onChange: emailStepSchema },
    onSubmitInvalid: focusFirstInvalid,
    onSubmit: async ({ value }) => {
      const input = emailStepSchema.parse(value)
      await sendCode.mutateAsync(input.email).catch(() => undefined)
    },
  })

  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <form.Subscribe selector={(state) => state.submissionAttempts > 0}>
        {(submitted) => (
          <form.Field name="email">
            {(field) => {
              const error = fieldError(field.state.meta, submitted)
              return (
                <FormField id="reset-email" label="Email" error={error}>
                  <Input
                    {...fieldAria('reset-email', error)}
                    type="email"
                    autoComplete="username"
                    placeholder="you@example.com"
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    onBlur={field.handleBlur}
                  />
                </FormField>
              )
            }}
          </form.Field>
        )}
      </form.Subscribe>
      <FormError message={formErrorMessage(sendCode.error)} />
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(submitting) => (
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Подождите…' : 'Получить код'}
          </Button>
        )}
      </form.Subscribe>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span />
        <Link to="/login" className={linkButtonClass}>
          Вернуться ко входу
        </Link>
      </div>
    </form>
  )
}

function CodeStep({
  email,
  cooldown,
  resend,
}: {
  email: string
  cooldown: number
  resend: SendCodeMutation
}) {
  const navigate = useNavigate()
  const reset = useMutation({
    mutationFn: resetPassword,
    onSuccess: async () => {
      toast('Пароль изменён.')
      await navigate({ to: '/account', ignoreBlocker: true })
    },
  })

  const form = useForm({
    defaultValues: { code: '', password: '', repeat: '' },
    validators: { onChange: codeStepSchema },
    onSubmitInvalid: focusFirstInvalid,
    onSubmit: async ({ value }) => {
      const input = codeStepSchema.parse(value)
      await reset
        .mutateAsync({ email, code: input.code, password: input.password })
        .catch(focusFirstInvalid)
    },
  })
  const isDirty = useStore(form.store, (state) => state.isDirty)
  const { dialog } = useUnsavedChangesGuard(isDirty)
  const serverCode = reset.error?.fields['code']

  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <form.Subscribe selector={(state) => state.submissionAttempts > 0}>
        {(submitted) => (
          <>
            <form.Field name="code">
              {(field) => (
                <OtpField
                  id="reset-code"
                  value={field.state.value}
                  error={fieldError(field.state.meta, submitted, serverCode)}
                  onChange={(value) => {
                    if (serverCode) {
                      reset.reset()
                    }
                    field.handleChange(value)
                  }}
                  onBlur={field.handleBlur}
                />
              )}
            </form.Field>
            <form.Field name="password">
              {(field) => {
                const error = fieldError(field.state.meta, submitted)
                return (
                  <FormField
                    id="reset-password"
                    label="Новый пароль"
                    error={error}
                    hint={PASSWORD_HINT}
                  >
                    <PasswordInput
                      id="reset-password"
                      autoComplete="new-password"
                      value={field.state.value}
                      onChange={field.handleChange}
                      onBlur={field.handleBlur}
                      error={error}
                      hint
                    />
                  </FormField>
                )
              }}
            </form.Field>
            <form.Field name="repeat">
              {(field) => {
                const error = fieldError(field.state.meta, submitted)
                return (
                  <FormField
                    id="reset-repeat"
                    label="Повторите новый пароль"
                    error={error}
                  >
                    <PasswordInput
                      id="reset-repeat"
                      autoComplete="new-password"
                      value={field.state.value}
                      onChange={field.handleChange}
                      onBlur={field.handleBlur}
                      error={error}
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
          formErrorMessage(reset.error) ?? formErrorMessage(resend.error)
        }
      />
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(submitting) => (
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Подождите…' : 'Сменить пароль'}
          </Button>
        )}
      </form.Subscribe>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <button
          type="button"
          className={linkButtonClass}
          disabled={cooldown > 0 || resend.isPending}
          onClick={() => resend.mutate(email)}
        >
          {resendLabel(cooldown)}
        </button>
        <Link to="/login" className={linkButtonClass}>
          Вернуться ко входу
        </Link>
      </div>
      {dialog}
    </form>
  )
}
