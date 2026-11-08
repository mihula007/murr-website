import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useForm } from '@tanstack/react-form'
import { useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import type { MeResponse } from '@contracts/account'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useSession } from '@/features/auth/session'
import {
  authErrorCode,
  authErrorMessage,
  requireSupabase,
} from '@/features/auth/supabase-auth'
import { meQueryKey } from '@/features/auth/use-me'
import { ApiCallError, callApi } from '@/lib/api/client'
import { errorMessage } from '@/lib/api/messages'
import { AuthPage, FormError } from './auth-layout'
import { focusFirstInvalid } from './focus'
import {
  FormField,
  PasswordInput,
  fieldAria,
  fieldError,
} from './form-controls'

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('invalid_email')),
  password: z.string().min(1, 'required'),
})

export function LoginPage({ email = '' }: { email?: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const session = useSession()
  const [formError, setFormError] = useState<string | null>(null)

  const form = useForm({
    defaultValues: { email, password: '' },
    validators: { onChange: loginSchema },
    onSubmitInvalid: focusFirstInvalid,
    onSubmit: async ({ value }) => {
      setFormError(null)
      const input = loginSchema.parse(value)
      try {
        const { data, error } =
          await requireSupabase().auth.signInWithPassword(input)
        if (error) {
          if (authErrorCode(error) === 'email_not_confirmed') {
            await navigate({
              to: '/register/verify',
              search: { email: input.email },
            })
            return
          }
          setFormError(authErrorMessage(error))
          return
        }
        const me = await callApi<MeResponse>('account/me')
        queryClient.setQueryData(meQueryKey(data.user.id), me)
        await navigate({
          to: me.state === 'incomplete' ? '/register/complete' : '/',
        })
      } catch (error) {
        setFormError(
          error instanceof ApiCallError
            ? errorMessage(error.code)
            : authErrorMessage(error),
        )
      }
    },
  })

  return (
    <AuthPage
      title="Вход в Murr клан"
      description="Войди в аккаунт, чтобы продолжить."
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
            <>
              <form.Field name="email">
                {(field) => {
                  const error = fieldError(field.state.meta, submitted)
                  return (
                    <FormField
                      id="login-email"
                      label="Email, указанный при регистрации"
                      error={error}
                    >
                      <Input
                        {...fieldAria('login-email', error)}
                        type="email"
                        autoComplete="username"
                        placeholder="you@example.com"
                        value={field.state.value}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                        onBlur={field.handleBlur}
                      />
                    </FormField>
                  )
                }}
              </form.Field>
              <form.Field name="password">
                {(field) => {
                  const error = fieldError(field.state.meta, submitted)
                  return (
                    <FormField id="login-password" label="Пароль" error={error}>
                      <PasswordInput
                        id="login-password"
                        autoComplete="current-password"
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
        <FormError message={formError} />
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(submitting) => (
            <Button
              type="submit"
              disabled={submitting || session.status === 'unavailable'}
            >
              {submitting ? 'Входим…' : 'Войти'}
            </Button>
          )}
        </form.Subscribe>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <Link to="/reset-password" className="link-button">
            Забыли пароль?
          </Link>
          <span className="text-muted-foreground">
            Нет аккаунта?{' '}
            <Link
              to="/register"
              className="text-primary underline underline-offset-4"
            >
              Вступить в клан
            </Link>
          </span>
        </div>
      </form>
    </AuthPage>
  )
}
