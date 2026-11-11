import { Link, useNavigate } from '@tanstack/react-router'
import { useForm } from '@tanstack/react-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import type { MeResponse } from '@contracts/account'
import { focusFirstInvalid } from '@/components/form/focus-first-invalid'
import { FormError } from '@/components/form/form-error'
import { FormField, fieldAria, fieldError } from '@/components/form/form-field'
import { PasswordInput } from '@/components/form/password-input'
import { Button, linkButtonClass } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { meQueryKey } from '@/features/account/use-me'
import { formErrorMessage, type AppError } from '@/lib/errors'
import { callApi } from '@/lib/supabase/api'
import { signIn, type Credentials } from './auth-api'
import { AuthPage } from './auth-page'
import { emailSchema } from './schemas'
import { useSession } from './session'

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'required'),
})

export function LoginPage({ email = '' }: { email?: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const session = useSession()

  const login = useMutation({
    mutationFn: async (credentials: Credentials) => {
      const userId = await signIn(credentials)
      return { userId, me: await callApi<MeResponse>('account/me') }
    },
    onSuccess: ({ userId, me }) => {
      queryClient.setQueryData(meQueryKey(userId), me)
    },
  })

  const form = useForm({
    defaultValues: { email, password: '' },
    validators: { onChange: loginSchema },
    onSubmitInvalid: focusFirstInvalid,
    onSubmit: async ({ value }) => {
      const input = loginSchema.parse(value)
      try {
        const { me } = await login.mutateAsync(input)
        await navigate({
          to: me.state === 'incomplete' ? '/register/complete' : '/',
        })
      } catch (error) {
        if ((error as AppError).code === 'email_not_confirmed') {
          await navigate({
            to: '/register/verify',
            search: { email: input.email },
          })
        }
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
        <FormError
          message={
            login.error?.code === 'email_not_confirmed'
              ? null
              : formErrorMessage(login.error)
          }
        />
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
          <Link to="/reset-password" className={linkButtonClass}>
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
