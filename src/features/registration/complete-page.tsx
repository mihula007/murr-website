import { Link, Navigate, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { RegistrationFields } from '@contracts/account'
import { useAccess } from '@/app/access'
import { LoadingState } from '@/components/states/loading-state'
import { Button, linkButtonClass } from '@/components/ui/button'
import { Notice } from '@/components/ui/surfaces'
import { toast } from '@/components/ui/toaster'
import { meQueryKey } from '@/features/account/use-me'
import { AuthPage } from '@/features/auth/auth-page'
import { useSession } from '@/features/auth/session'
import { useSignOut } from '@/features/auth/use-sign-out'
import { cn } from '@/lib/utils'
import { finishRegistration } from './finish-registration'
import { clearDraft, getPendingAvatar, loadDraft } from './registration-draft'
import { RegistrationForm } from './registration-form'

type CompleteInput = { fields: RegistrationFields; avatar: Blob }

/** «Завершите регистрацию»: почта подтверждена, профиля и заявки ещё нет (Q-28). */
export function CompleteRegistrationPage() {
  const access = useAccess()
  const session = useSession()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const signOut = useSignOut(clearDraft)
  const complete = useMutation({
    mutationFn: ({ fields, avatar }: CompleteInput) =>
      finishRegistration(fields, avatar),
    onSuccess: async (me) => {
      queryClient.setQueryData(meQueryKey(session.session?.user.id), me)
      toast('Заявка отправлена. Статус виден в личном кабинете.')
      await navigate({ to: '/', ignoreBlocker: true })
    },
  })

  if (access.status === 'loading') {
    return <LoadingState label="Загружаем аккаунт…" />
  }
  if (access.status === 'ready') {
    return <Navigate to="/account" />
  }
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
        onSubmit={({ email: _email, password: _password, ...fields }, avatar) =>
          complete.mutateAsync({ fields, avatar })
        }
      />
      <button
        type="button"
        className={cn(linkButtonClass, 'justify-self-center')}
        disabled={signOut.isPending}
        onClick={() => signOut.mutate()}
      >
        Выйти из аккаунта
      </button>
    </AuthPage>
  )
}
