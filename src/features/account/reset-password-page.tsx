import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { z } from 'zod'
import { LIMITS } from '@contracts/account'
import { Button, linkButtonClass } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toaster'
import {
  authErrorMessage,
  requireSupabase,
} from '@/features/auth/supabase-auth'
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard'
import { fieldMessage } from '@/lib/api/messages'
import { AuthPage, FormError } from './auth-layout'
import { FormField, PasswordInput, fieldAria } from './form-controls'
import { OtpField, useCountdown } from './verify-page'

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('invalid_email'))

/** Восстановление пароля кодом из письма (ACC-11, Q-30), без redirect-ссылок. */
export function ResetPasswordPage({
  email: initialEmail = '',
}: {
  email?: string
}) {
  const navigate = useNavigate()
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState(initialEmail)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [cooldown, startCooldown] = useCountdown()
  const { dialog } = useUnsavedChangesGuard(
    step === 'code' && (code !== '' || password !== '' || repeat !== ''),
  )

  async function sendCode() {
    const parsed = emailSchema.safeParse(email)
    if (!parsed.success) {
      setErrors({ email: fieldMessage('invalid_email') })
      return
    }
    setBusy(true)
    setFormError(null)
    try {
      const { error } = await requireSupabase().auth.resetPasswordForEmail(
        parsed.data,
      )
      if (error) {
        setFormError(authErrorMessage(error))
        return
      }
      setEmail(parsed.data)
      setStep('code')
      startCooldown()
    } catch (error) {
      setFormError(authErrorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  async function changePassword() {
    const next: Record<string, string> = {}
    if (code.length !== 6) next.code = fieldMessage('invalid_code')
    if (password.length < LIMITS.passwordMin)
      next.password = fieldMessage('password_short')
    if (repeat !== password) next.repeat = fieldMessage('password_mismatch')
    setErrors(next)
    if (Object.keys(next).length > 0) return
    setBusy(true)
    setFormError(null)
    try {
      const supabase = requireSupabase()
      const verified = await supabase.auth.verifyOtp({
        email,
        token: code,
        type: 'recovery',
      })
      if (verified.error) {
        setErrors({ code: authErrorMessage(verified.error) })
        return
      }
      const updated = await supabase.auth.updateUser({ password })
      if (updated.error) {
        setFormError(authErrorMessage(updated.error))
        return
      }
      toast('Пароль изменён.')
      await navigate({ to: '/account', ignoreBlocker: true })
    } catch (error) {
      setFormError(authErrorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthPage
      title="Восстановление пароля"
      description={
        step === 'email'
          ? 'Укажи email аккаунта — пришлём код для смены пароля.'
          : `Если аккаунт с адресом ${email} существует, мы отправили на него код.`
      }
    >
      <form
        noValidate
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          void (step === 'email' ? sendCode() : changePassword())
        }}
      >
        {step === 'email' ? (
          <FormField id="reset-email" label="Email" error={errors.email}>
            <Input
              {...fieldAria('reset-email', errors.email)}
              type="email"
              autoComplete="username"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => {
                setErrors({})
                setEmail(event.target.value)
              }}
            />
          </FormField>
        ) : (
          <>
            <OtpField
              id="reset-code"
              value={code}
              error={errors.code ?? null}
              onChange={setCode}
            />
            <FormField
              id="reset-password"
              label="Новый пароль"
              error={errors.password}
              hint="Минимум 8 символов"
            >
              <PasswordInput
                id="reset-password"
                autoComplete="new-password"
                value={password}
                onChange={setPassword}
                error={errors.password}
                hint
              />
            </FormField>
            <FormField
              id="reset-repeat"
              label="Повторите новый пароль"
              error={errors.repeat}
            >
              <PasswordInput
                id="reset-repeat"
                autoComplete="new-password"
                value={repeat}
                onChange={setRepeat}
                error={errors.repeat}
              />
            </FormField>
          </>
        )}
        <FormError message={formError} />
        <Button type="submit" disabled={busy}>
          {busy
            ? 'Подождите…'
            : step === 'email'
              ? 'Получить код'
              : 'Сменить пароль'}
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          {step === 'code' ? (
            <button
              type="button"
              className={linkButtonClass}
              disabled={cooldown > 0}
              onClick={() => void sendCode()}
            >
              {cooldown > 0
                ? `Отправить код ещё раз через ${cooldown} с`
                : 'Отправить код ещё раз'}
            </button>
          ) : (
            <span />
          )}
          <Link to="/login" className={linkButtonClass}>
            Вернуться ко входу
          </Link>
        </div>
      </form>
      {dialog}
    </AuthPage>
  )
}
