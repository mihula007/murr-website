import { useState } from 'react'
import { Navigate, useNavigate } from '@tanstack/react-router'
import type { MeResponse } from '@contracts/account'
import { useAccess } from '@/app/access'
import { ErrorState } from '@/components/states/error-state'
import { LoadingState } from '@/components/states/loading-state'
import { PageHeader } from '@/components/states/page-header'
import { Button } from '@/components/ui/button'
import { Badge, Card, Notice } from '@/components/ui/surfaces'
import { clearDraft } from '@/features/auth/registration-draft'
import { requireSupabase } from '@/features/auth/supabase-auth'
import { useMe } from '@/features/auth/use-me'
import { cn } from '@/lib/utils'
import { disclosureClass, profilePhotoClass } from './form-controls'
import { PasswordForm } from './password-form'
import { ProfileForm } from './profile-form'
import { APPLICATION_STATUS, ROLE_STATUS } from './status-labels'

type ReadyMe = Extract<MeResponse, { state: 'ready' }>

function formatDate(value: string | null) {
  if (!value) return '—'
  const [year, month, day] = value.slice(0, 10).split('-')
  return `${day}.${month}.${year}`
}

function Dashboard({ me }: { me: ReadyMe }) {
  const navigate = useNavigate()
  const { profile, application } = me
  const [editing, setEditing] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const status =
    profile.role === 'applicant'
      ? application
        ? APPLICATION_STATUS[application.status].label
        : 'Аккаунт создан'
      : ROLE_STATUS[profile.role]
  const notice =
    profile.role === 'applicant' && application
      ? APPLICATION_STATUS[application.status].notice
      : null

  // Сначала уходим на главную: иначе кабинет сам перенаправит гостя ко входу (ACC-12).
  async function signOut() {
    clearDraft()
    await navigate({ to: '/' })
    await requireSupabase().auth.signOut()
  }

  return (
    <section>
      <PageHeader
        title="Личный кабинет"
        description="Профиль, статус и безопасность аккаунта."
      />
      <Card className="mx-auto grid w-full max-w-[620px] gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold">
              Привет, {profile.displayName}!
            </h2>
            <p className="text-muted-foreground">Статус аккаунта и заявки</p>
          </div>
          <Badge>{status}</Badge>
        </div>
        <div className="flex min-w-0 items-center gap-3.5">
          <div className={cn(profilePhotoClass, 'size-[76px]')}>
            {profile.avatarUrl ? (
              <img
                src={profile.avatarUrl}
                alt={`Аватар ${profile.gameNickname}`}
              />
            ) : (
              <span aria-hidden="true">
                {profile.gameNickname.slice(0, 1).toUpperCase()}
              </span>
            )}
          </div>
          <div className="min-w-0">
            <strong className="block break-words">{profile.displayName}</strong>
            <span className="text-muted-foreground">
              {profile.gameNickname} · {profile.className}
            </span>
          </div>
        </div>
        <p className="break-words text-muted-foreground">{me.email}</p>

        <details className={disclosureClass}>
          <summary>Личная информация</summary>
          {editing ? (
            <ProfileForm
              profile={profile}
              email={me.email}
              onDone={() => setEditing(false)}
            />
          ) : (
            <div className="grid gap-3">
              <dl className="m-0 grid grid-cols-2 gap-x-[18px] gap-y-2 max-[560px]:grid-cols-1 [&_dd]:m-0 [&_dt]:text-xs [&_dt]:text-muted-foreground">
                <div>
                  <dt>Имя</dt>
                  <dd>{profile.displayName}</dd>
                </div>
                <div>
                  <dt>Город</dt>
                  <dd>{profile.city ?? '—'}</dd>
                </div>
                <div>
                  <dt>Игровой никнейм</dt>
                  <dd>{profile.gameNickname}</dd>
                </div>
                <div>
                  <dt>Электронная почта</dt>
                  <dd className="break-words">{me.email}</dd>
                </div>
                <div>
                  <dt>Класс персонажа</dt>
                  <dd>{profile.className}</dd>
                </div>
                <div>
                  <dt>Дата рождения</dt>
                  <dd>{formatDate(profile.birthDate)}</dd>
                </div>
                {profile.joinedOn ? (
                  <div>
                    <dt>Дата вступления</dt>
                    <dd>{formatDate(profile.joinedOn)}</dd>
                  </div>
                ) : null}
                <div className="col-span-full">
                  <dt>О себе</dt>
                  <dd className="whitespace-pre-line">
                    {profile.about ?? '—'}
                  </dd>
                </div>
              </dl>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="justify-self-start"
                onClick={() => setEditing(true)}
              >
                Изменить личную информацию
              </Button>
            </div>
          )}
        </details>

        <details
          className={disclosureClass}
          open={passwordOpen}
          onToggle={(event) => setPasswordOpen(event.currentTarget.open)}
        >
          <summary>Смена пароля</summary>
          {passwordOpen ? (
            <PasswordForm
              email={me.email}
              onDone={() => setPasswordOpen(false)}
            />
          ) : null}
        </details>

        {notice ? <Notice>{notice}</Notice> : null}
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          onClick={() => void signOut()}
        >
          Выйти
        </Button>
        {profile.role === 'applicant' ? (
          <p className="text-sm text-muted-foreground">
            Статус заявки обновляется после действий офицера, голосования и
            решения администрации.
          </p>
        ) : null}
      </Card>
    </section>
  )
}

/** Личный кабинет (ACC-05, ACC-06): гостя ведёт ко входу, незавершённую регистрацию — к её завершению. */
export function AccountPage() {
  const access = useAccess()
  const me = useMe()
  if (access.status === 'loading')
    return <LoadingState label="Загружаем аккаунт…" />
  if (access.status === 'guest') return <Navigate to="/login" />
  if (access.status === 'incomplete')
    return <Navigate to="/register/complete" />
  if (access.status === 'error' || me.data?.state !== 'ready') {
    return <ErrorState onRetry={() => void me.refetch()} />
  }
  return <Dashboard me={me.data} />
}
