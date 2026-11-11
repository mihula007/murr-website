import { Link, Navigate, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useAccess } from '@/app/access'
import { LoadingState } from '@/components/states/loading-state'
import { Button, linkButtonClass } from '@/components/ui/button'
import { Notice } from '@/components/ui/surfaces'
import { toast } from '@/components/ui/toaster'
import { finishRegistration } from '@/features/auth/finish-registration'
import {
  clearDraft,
  getPendingAvatar,
  loadDraft,
} from '@/features/auth/registration-draft'
import { useSession } from '@/features/auth/session'
import { requireSupabase } from '@/features/auth/supabase-auth'
import { meQueryKey } from '@/features/auth/use-me'
import { ApiCallError } from '@/lib/api/client'
import { errorMessage, fieldMessage } from '@/lib/api/messages'
import { cn } from '@/lib/utils'
import { AuthPage } from './auth-layout'
import { RegistrationForm } from './registration-form'

/** «Завершите регистрацию»: почта подтверждена, профиля и заявки ещё нет (Q-28). */
export function CompleteRegistrationPage() {
  const access = useAccess()
  const session = useSession()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  if (access.status === 'loading')
    return <LoadingState label="Загружаем аккаунт…" />
  if (access.status === 'ready') return <Navigate to="/account" />
  if (access.status !== 'incomplete') {
    return (
      <AuthPage title="Завершите регистрацию">
        <p className="text-muted-foreground">
          Войдите в аккаунт, чтобы продолжить регистрацию.
        </p>
        <Button asChild>
          <Link to="/login">Войти</Link>
        </Button>
      </AuthPage>
    )
  }

  return (
    <AuthPage
      title="Завершите регистрацию"
      description="Почта подтверждена. Проверьте анкету и аватар — после отправки будет создана заявка в клан."
    >
      <Notice>
        Аккаунт: <strong>{session.session?.user.email}</strong>. Если вы
        закрывали вкладку, аватар нужно выбрать заново.
      </Notice>
      <RegistrationForm
        mode="complete"
        draft={loadDraft()}
        initialAvatar={getPendingAvatar()}
        submitLabel="Отправить заявку"
        onSubmit={async (
          { email: _email, password: _password, ...fields },
          avatar,
        ) => {
          try {
            const me = await finishRegistration(fields, avatar)
            queryClient.setQueryData(meQueryKey(session.session?.user.id), me)
            toast('Заявка отправлена. Статус виден в личном кабинете.')
            await navigate({ to: '/', ignoreBlocker: true })
          } catch (error) {
            if (!(error instanceof ApiCallError))
              return { form: errorMessage('network') }
            if (error.code === 'avatar_invalid') {
              return { avatar: fieldMessage('avatar_invalid') }
            }
            return {
              fields: error.code === 'validation_failed' ? error.fields : {},
              form: errorMessage(error.code),
            }
          }
        }}
      />
      <button
        type="button"
        className={cn(linkButtonClass, 'justify-self-center')}
        onClick={() => {
          clearDraft()
          void requireSupabase().auth.signOut()
        }}
      >
        Выйти из аккаунта
      </button>
    </AuthPage>
  )
}
