import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { LIMITS } from '@contracts/account'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toaster'
import {
  authErrorMessage,
  requireSupabase,
} from '@/features/auth/supabase-auth'
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard'
import { fieldMessage } from '@/lib/api/messages'
import { FormError } from './auth-layout'
import { FormField, PasswordInput } from './form-controls'

type Fields = { current: string; next: string; repeat: string }
const EMPTY: Fields = { current: '', next: '', repeat: '' }

/** Смена своего пароля (ACC-09, ACC-10); доступна и чтецу. Без аудита (Q-34). */
export function PasswordForm({
  email,
  onDone,
}: {
  email: string
  onDone: () => void
}) {
  const [values, setValues] = useState<Fields>(EMPTY)
  const [errors, setErrors] = useState<Partial<Fields>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { dialog } = useUnsavedChangesGuard(
    Object.values(values).some((value) => value !== ''),
  )

  const set = (name: keyof Fields) => (value: string) => {
    setErrors(({ [name]: _removed, ...rest }) => rest)
    setValues((current) => ({ ...current, [name]: value }))
  }

  async function submit() {
    const next: Partial<Fields> = {}
    if (!values.current) next.current = 'Введите текущий пароль'
    if (values.next.length < LIMITS.passwordMin)
      next.next = fieldMessage('password_short')
    if (values.repeat !== values.next)
      next.repeat = fieldMessage('password_mismatch')
    setErrors(next)
    setFormError(null)
    if (Object.keys(next).length > 0) {
      document.getElementById(`password-${Object.keys(next)[0]}`)?.focus()
      return
    }
    setBusy(true)
    try {
      const supabase = requireSupabase()
      // Текущий пароль проверяется повторным входом той же учётной записи.
      const check = await supabase.auth.signInWithPassword({
        email,
        password: values.current,
      })
      if (check.error) {
        setErrors({ current: 'Текущий пароль указан неверно' })
        document.getElementById('password-current')?.focus()
        return
      }
      const { error } = await supabase.auth.updateUser({
        password: values.next,
      })
      if (error) {
        setFormError(authErrorMessage(error))
        return
      }
      setValues(EMPTY)
      toast('Пароль изменён')
      onDone()
    } catch (error) {
      setFormError(authErrorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      noValidate
      className="account-subform grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <div>
        <h3 className="text-lg font-bold">Обновить пароль</h3>
        <p className="text-sm text-muted-foreground">
          Для защиты аккаунта сначала подтверди текущий пароль.
        </p>
      </div>
      <div className="grid gap-3">
        <FormField
          id="password-current"
          label="Текущий пароль"
          error={errors.current}
        >
          <PasswordInput
            id="password-current"
            autoComplete="current-password"
            value={values.current}
            onChange={set('current')}
            error={errors.current}
          />
        </FormField>
        <FormField
          id="password-next"
          label="Новый пароль"
          error={errors.next}
          hint="Минимум 8 символов"
        >
          <PasswordInput
            id="password-next"
            autoComplete="new-password"
            value={values.next}
            onChange={set('next')}
            error={errors.next}
            hint
          />
        </FormField>
        <FormField
          id="password-repeat"
          label="Повторите новый пароль"
          error={errors.repeat}
        >
          <PasswordInput
            id="password-repeat"
            autoComplete="new-password"
            value={values.repeat}
            onChange={set('repeat')}
            error={errors.repeat}
          />
        </FormField>
      </div>
      <FormError message={formError} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? 'Меняем…' : 'Изменить пароль'}
        </Button>
        <Link
          to="/reset-password"
          search={{ email }}
          className="link-button text-sm"
        >
          Забыли пароль?
        </Link>
      </div>
      {dialog}
    </form>
  )
}
