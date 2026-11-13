import { useState } from 'react'
import { Navigate, useNavigate } from '@tanstack/react-router'
import { ChevronDown } from 'lucide-react'
import type { MeResponse } from '@contracts/account'
import { useAccess } from '@/app/access'
import { ErrorState } from '@/components/states/error-state'
import { LoadingState } from '@/components/states/loading-state'
import { PageHeader } from '@/components/states/page-header'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Badge, Card } from '@/components/ui/surfaces'
import { ApplicantPath } from '@/features/applications/applicant-path'
import { useSignOut } from '@/features/auth/use-sign-out'
import { clearDraft } from '@/features/registration/registration-draft'
import { formatDate } from '@/lib/format-date'
import { PasswordForm } from './password-form'
import { ProfileForm } from './profile-form'
import { APPLICATION_STATUS, ROLE_STATUS } from './status-labels'
import { useMe } from './use-me'

type ReadyMe = Extract<MeResponse, { state: 'ready' }>

/**
 * Раскрывающийся блок кабинета (`<details>`) с золотым заголовком. Вместо
 * системного треугольника — шеврон lucide, как в остальных раскрывающихся
 * элементах интерфейса.
 */
const disclosureClass =
  'group border-y border-border py-3 [&>summary]:flex [&>summary]:min-h-11 [&>summary]:cursor-pointer [&>summary]:list-none [&>summary]:items-center [&>summary]:justify-between [&>summary]:gap-3 [&>summary]:font-bold [&>summary]:text-primary [&>summary::-webkit-details-marker]:hidden open:[&>summary]:mb-3'

function DisclosureSummary({ children }: { children: string }) {
  return (
    <summary>
      {children}
      <ChevronDown
        aria-hidden="true"
        size={18}
        className="flex-none transition-transform duration-200 group-open:rotate-180"
      />
    </summary>
  )
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

  // Сначала уходим на главную: иначе кабинет сам перенаправит гостя ко входу (ACC-12).
  const signOut = useSignOut(async () => {
    clearDraft()
    await navigate({ to: '/' })
  })

  return (
    <section className="mx-auto w-full max-w-[620px]">
      <PageHeader
        title="Личный кабинет"
        description="Профиль, статус и безопасность аккаунта."
      />
      <Card className="grid gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold">
              Привет, {profile.displayName}!
            </h2>
            {profile.role === 'applicant' ? (
              <p className="text-muted-foreground">Статус аккаунта и заявки</p>
            ) : null}
          </div>
          <Badge>{status}</Badge>
        </div>
        <div className="flex min-w-0 items-center gap-3.5">
          <Avatar
            size="lg"
            name={profile.gameNickname}
            src={profile.avatarUrl}
            alt={`Аватар ${profile.gameNickname}`}
          />
          <div className="min-w-0">
            <strong className="block break-words">{profile.displayName}</strong>
            <span className="text-muted-foreground">
              {profile.gameNickname} · {profile.className}
            </span>
          </div>
        </div>
        <p className="break-words text-muted-foreground">{me.email}</p>

        <details className={disclosureClass}>
          <DisclosureSummary>Личная информация</DisclosureSummary>
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
          <DisclosureSummary>Смена пароля</DisclosureSummary>
          {passwordOpen ? (
            <PasswordForm
              email={me.email}
              onDone={() => setPasswordOpen(false)}
            />
          ) : null}
        </details>

        {profile.role === 'applicant' ? (
          <ApplicantPath
            application={application}
            canResubmit={me.canResubmit}
            className="bg-none p-4"
          />
        ) : null}
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          disabled={signOut.isPending}
          onClick={() => signOut.mutate()}
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
  if (access.status === 'loading') {
    return <LoadingState label="Загружаем аккаунт…" />
  }
  if (access.status === 'guest') {
    return <Navigate to="/login" />
  }
  if (access.status === 'incomplete') {
    return <Navigate to="/register/complete" />
  }
  if (access.status === 'error' || me.data?.state !== 'ready') {
    return <ErrorState onRetry={() => void me.refetch()} />
  }
  return <Dashboard me={me.data} />
}
