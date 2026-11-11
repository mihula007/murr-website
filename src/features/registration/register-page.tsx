import { useNavigate } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { toast } from '@/components/ui/toaster'
import { signUp } from '@/features/auth/auth-api'
import { AuthPage } from '@/features/auth/auth-page'
import {
  getPendingAvatar,
  loadDraft,
  saveDraft,
  setPendingAvatar,
} from './registration-draft'
import { RegistrationForm, type RegistrationValues } from './registration-form'

type SignUpInput = { values: RegistrationValues; avatar: Blob }

/** Шаги 1–3 регистрации: анкета → аккаунт Auth → письмо с кодом. */
export function RegisterPage() {
  const navigate = useNavigate()
  const register = useMutation({
    mutationFn: ({ values }: SignUpInput) =>
      signUp({ email: values.email, password: values.password }),
    onSuccess: async (result, { values, avatar }) => {
      const { password: _password, ...fields } = values
      if (result === 'exists') {
        toast('Аккаунт с этим email уже существует — войдите.')
        await navigate({
          to: '/login',
          search: { email: fields.email },
          ignoreBlocker: true,
        })
        return
      }
      saveDraft(fields)
      setPendingAvatar(avatar)
      await navigate({
        to: '/register/verify',
        search: { email: fields.email },
        ignoreBlocker: true,
      })
    },
  })

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
        onSubmit={(values, avatar) => register.mutateAsync({ values, avatar })}
      />
    </AuthPage>
  )
}
