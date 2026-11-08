import { useEffect, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { registrationFieldsSchema } from '@contracts/account'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toaster'
import { finishRegistration } from '@/features/auth/finish-registration'
import { getPendingAvatar, loadDraft } from '@/features/auth/registration-draft'
import {
  authErrorMessage,
  requireSupabase,
} from '@/features/auth/supabase-auth'
import { meQueryKey } from '@/features/auth/use-me'
import { AuthPage, FormError } from './auth-layout'
import { FormField, fieldAria } from './form-controls'

const RESEND_SECONDS = 60

export function useCountdown() {
  const [left, setLeft] = useState(0)
  useEffect(() => {
    if (left <= 0) return
    const timer = setTimeout(() => setLeft((value) => value - 1), 1000)
    return () => clearTimeout(timer)
  }, [left])
  return [left, () => setLeft(RESEND_SECONDS)] as const
}

export function OtpField({
  id,
  value,
  onChange,
  error,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  error: string | null
}) {
  return (
    <FormField id={id} label="Код из письма" error={error} hint="6 цифр">
      <Input
        {...fieldAria(id, error, true)}
        className="otp-input"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, ''))}
      />
    </FormField>
  )
}

/** Шаг 4 регистрации: подтверждение email кодом, затем завершение (Q-28). */
export function VerifyPage({ email }: { email?: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [cooldown, startCooldown] = useCountdown()

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

  async function verify() {
    if (code.length !== 6) {
      setCodeError('Код — 6 цифр из письма')
      return
    }
    setBusy(true)
    setFormError(null)
    try {
      const supabase = requireSupabase()
      const { data, error } = await supabase.auth.verifyOtp({
        email: email as string,
        token: code,
        type: 'signup',
      })
      if (error || !data.user) {
        setCodeError(authErrorMessage(error))
        return
      }
      const draft = registrationFieldsSchema.safeParse(loadDraft() ?? {})
      const avatar = getPendingAvatar()
      if (!draft.success || !avatar) {
        await navigate({ to: '/register/complete' })
        return
      }
      try {
        const me = await finishRegistration(draft.data, avatar)
        queryClient.setQueryData(meQueryKey(data.user.id), me)
        toast('Заявка отправлена. Статус виден в личном кабинете.')
        await navigate({ to: '/' })
      } catch {
        // Email подтверждён, а сохранение не удалось: продолжить на экране завершения.
        toast('Почта подтверждена. Проверьте анкету и завершите регистрацию.')
        await navigate({ to: '/register/complete' })
      }
    } catch (error) {
      setFormError(authErrorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  async function resend() {
    setFormError(null)
    try {
      const { error } = await requireSupabase().auth.resend({
        type: 'signup',
        email: email as string,
      })
      if (error) {
        setFormError(authErrorMessage(error))
        return
      }
      startCooldown()
      toast('Новый код отправлен.')
    } catch (error) {
      setFormError(authErrorMessage(error))
    }
  }

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
          void verify()
        }}
      >
        <OtpField
          id="verify-code"
          value={code}
          error={codeError}
          onChange={(value) => {
            setCodeError(null)
            setCode(value)
          }}
        />
        <FormError message={formError} />
        <Button type="submit" disabled={busy}>
          {busy ? 'Проверяем…' : 'Подтвердить'}
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <button
            type="button"
            className="link-button"
            disabled={cooldown > 0}
            onClick={() => void resend()}
          >
            {cooldown > 0
              ? `Отправить код ещё раз через ${cooldown} с`
              : 'Отправить код ещё раз'}
          </button>
          <Link to="/register" className="link-button">
            Изменить данные
          </Link>
        </div>
      </form>
    </AuthPage>
  )
}
