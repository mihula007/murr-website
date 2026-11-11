import { Link, useNavigate } from '@tanstack/react-router'
import { useForm } from '@tanstack/react-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { registrationFieldsSchema } from '@contracts/account'
import { focusFirstInvalid } from '@/components/form/focus-first-invalid'
import { FormError } from '@/components/form/form-error'
import { fieldError } from '@/components/form/form-field'
import { Button, linkButtonClass } from '@/components/ui/button'
import { toast } from '@/components/ui/toaster'
import { meQueryKey } from '@/features/account/use-me'
import { resendSignupCode, verifySignupCode } from '@/features/auth/auth-api'
import { AuthPage } from '@/features/auth/auth-page'
import { OtpField, resendLabel, useCountdown } from '@/features/auth/otp-field'
import { otpCodeSchema } from '@/features/auth/schemas'
import { formErrorMessage } from '@/lib/errors'
import { finishRegistration } from './finish-registration'
import { getPendingAvatar, loadDraft } from './registration-draft'

const verifySchema = z.object({ code: otpCodeSchema })

/**
 * Подтверждение кода и, если анкета и аватар ещё во вкладке, завершение
 * регистрации. Сбой сохранения после подтверждения не теряет email: дальше
 * — экран завершения.
 */
async function confirmEmail(email: string, code: string) {
  const userId = await verifySignupCode({ email, code })
  const draft = registrationFieldsSchema.safeParse(loadDraft() ?? {})
  const avatar = getPendingAvatar()
  if (!draft.success || !avatar) return { userId, me: null, failed: false }
  try {
    return {
      userId,
      me: await finishRegistration(draft.data, avatar),
      failed: false,
    }
  } catch {
    return { userId, me: null, failed: true }
  }
}

/** Шаг 4 регистрации: подтверждение email кодом, затем завершение (Q-28). */
export function VerifyPage({ email }: { email?: string }) {
  if (!email) {
    return (
      <AuthPage title="Подтверждение почты">
        <p className="text-muted-foreground">
          Не указан адрес.{' '}
          <Link to="/register" className="text-primary underline">
            Вернуться к регистрации
          </Link>
        </p>
      </AuthPage>
    )
  }
  return <VerifyForm email={email} />
}

function VerifyForm({ email }: { email: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [cooldown, startCooldown] = useCountdown()

  const verify = useMutation({
    mutationFn: (code: string) => confirmEmail(email, code),
    onSuccess: async ({ userId, me, failed }) => {
      if (me) {
        queryClient.setQueryData(meQueryKey(userId), me)
        toast('Заявка отправлена. Статус виден в личном кабинете.')
        await navigate({ to: '/' })
        return
      }
      if (failed)
        toast('Почта подтверждена. Проверьте анкету и завершите регистрацию.')
      await navigate({ to: '/register/complete' })
    },
  })
  const resend = useMutation({
    mutationFn: () => resendSignupCode(email),
    onSuccess: () => {
      startCooldown()
      toast('Новый код отправлен.')
    },
  })

  const form = useForm({
    defaultValues: { code: '' },
    validators: { onChange: verifySchema },
    onSubmitInvalid: focusFirstInvalid,
    onSubmit: async ({ value }) => {
      await verify
        .mutateAsync(verifySchema.parse(value).code)
        .catch(focusFirstInvalid)
    },
  })
  const serverCode = verify.error?.fields['code']

  return (
    <AuthPage
      title="Подтверждение почты"
      description={
        <>
          Мы отправили код на{' '}
          <strong className="text-foreground">{email}</strong>. Введи его, чтобы
          завершить регистрацию.
        </>
      }
    >
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
            <form.Field name="code">
              {(field) => (
                <OtpField
                  id="verify-code"
                  value={field.state.value}
                  error={fieldError(field.state.meta, submitted, serverCode)}
                  onChange={(value) => {
                    if (serverCode) verify.reset()
                    field.handleChange(value)
                  }}
                  onBlur={field.handleBlur}
                />
              )}
            </form.Field>
          )}
        </form.Subscribe>
        <FormError
          message={
            formErrorMessage(verify.error) ?? formErrorMessage(resend.error)
          }
        />
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(submitting) => (
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Проверяем…' : 'Подтвердить'}
            </Button>
          )}
        </form.Subscribe>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <button
            type="button"
            className={linkButtonClass}
            disabled={cooldown > 0 || resend.isPending}
            onClick={() => resend.mutate()}
          >
            {resendLabel(cooldown)}
          </button>
          <Link to="/register" className={linkButtonClass}>
            Изменить данные
          </Link>
        </div>
      </form>
    </AuthPage>
  )
}
