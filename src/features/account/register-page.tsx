import { useNavigate } from '@tanstack/react-router'
import { toast } from '@/components/ui/toaster'
import {
  getPendingAvatar,
  loadDraft,
  saveDraft,
  setPendingAvatar,
} from '@/features/auth/registration-draft'
import {
  authErrorCode,
  authErrorMessage,
  requireSupabase,
} from '@/features/auth/supabase-auth'
import { ApiCallError } from '@/lib/api/client'
import { errorMessage } from '@/lib/api/messages'
import { AuthPage } from './auth-layout'
import { RegistrationForm } from './registration-form'

/** Шаги 1–3 регистрации: анкета → аккаунт Auth → письмо с кодом. */
export function RegisterPage() {
  const navigate = useNavigate()
  return (
    <AuthPage
      title="Создание учётной записи"
      description="Заполни анкету, чтобы подать заявку в клан. Код подтверждения придёт на почту."
    >
      <RegistrationForm
        mode="register"
        draft={loadDraft()}
        initialAvatar={getPendingAvatar()}
        onAvatarChange={setPendingAvatar}
        submitLabel="Создать учётную запись"
        onSubmit={async ({ password, ...fields }, avatar) => {
          try {
            const { data, error } = await requireSupabase().auth.signUp({
              email: fields.email,
              password,
            })
            // Подтверждённый адрес: Auth отвечает ошибкой или пользователем без identities.
            const exists =
              authErrorCode(error) === 'user_already_exists' ||
              (!error && data.user?.identities?.length === 0)
            if (exists) {
              toast('Аккаунт с этим email уже существует — войдите.')
              await navigate({
                to: '/login',
                search: { email: fields.email },
                ignoreBlocker: true,
              })
              return
            }
            if (error) return { form: authErrorMessage(error) }
            saveDraft(fields)
            setPendingAvatar(avatar)
            await navigate({
              to: '/register/verify',
              search: { email: fields.email },
              ignoreBlocker: true,
            })
          } catch (error) {
            return {
              form:
                error instanceof ApiCallError
                  ? errorMessage(error.code)
                  : authErrorMessage(error),
            }
          }
        }}
      />
    </AuthPage>
  )
}
