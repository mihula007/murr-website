import { useState } from 'react'
import { Link, Navigate, useNavigate } from '@tanstack/react-router'
import { useForm, useStore } from '@tanstack/react-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { equipmentLinksSchema, type MeResponse } from '@contracts/account'
import { focusFirstInvalid } from '@/components/form/focus-first-invalid'
import { FormError } from '@/components/form/form-error'
import { formLabelClass } from '@/components/form/form-field'
import { useAccess } from '@/app/access'
import { ErrorState } from '@/components/states/error-state'
import { LoadingState } from '@/components/states/loading-state'
import { PageHeader } from '@/components/states/page-header'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, Notice, fieldClass } from '@/components/ui/surfaces'
import { toast } from '@/components/ui/toaster'
import { meQueryKey, useMe } from '@/features/account/use-me'
import { useSession } from '@/features/auth/session'
import { EquipmentLinks } from '@/features/registration/equipment-links'
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard'
import { formatDate } from '@/lib/format-date'
import { errorMessage, fieldMessage, type AppError } from '@/lib/errors'
import { callApi } from '@/lib/supabase/api'
import { cn } from '@/lib/utils'

type ReadyMe = Extract<MeResponse, { state: 'ready' }>

const resubmitSchema = z.object({ equipmentLinks: equipmentLinksSchema })

/** Поля профиля, без которых заявка не принимается (Q-15, Q-31). */
const REQUIRED_PROFILE_FIELDS = {
  city: 'город',
  birthDate: 'дата рождения',
  about: 'рассказ о себе',
} as const
type RequiredField = keyof typeof REQUIRED_PROFILE_FIELDS

function missingFields(me: ReadyMe): RequiredField[] {
  return (Object.keys(REQUIRED_PROFILE_FIELDS) as RequiredField[]).filter(
    (field) => !me.profile[field],
  )
}

const summaryClass =
  'm-0 grid grid-cols-2 gap-x-[18px] gap-y-2 max-[560px]:grid-cols-1 [&_dd]:m-0 [&_dd]:break-words [&_dt]:text-xs [&_dt]:text-muted-foreground'

function ResubmitForm({ me }: { me: ReadyMe }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const session = useSession()
  const [formError, setFormError] = useState<string | null>(null)
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})
  const [serverMissing, setServerMissing] = useState<RequiredField[]>([])
  const { profile } = me
  const missing = [...new Set([...missingFields(me), ...serverMissing])]

  const resubmit = useMutation({
    mutationFn: (equipmentLinks: string[]) =>
      callApi<MeResponse>('applications/resubmit', { equipmentLinks }),
    onSuccess: async (next) => {
      toast('Новая заявка отправлена')
      // После подачи — на главную, как после регистрации (Q-21). Профиль
      // обновляется после ухода: иначе страница сама уведёт в кабинет.
      await navigate({ to: '/', ignoreBlocker: true })
      queryClient.setQueryData(meQueryKey(session.session?.user.id), next)
    },
  })

  const form = useForm({
    defaultValues: { equipmentLinks: [] as string[] },
    validators: { onChange: resubmitSchema },
    onSubmitInvalid: focusFirstInvalid,
    onSubmit: async ({ value }) => {
      setFormError(null)
      const { equipmentLinks } = resubmitSchema.parse(value)
      await resubmit
        .mutateAsync(equipmentLinks)
        .catch(({ code, fields }: AppError) => {
          if (code === 'state_conflict') {
            toast('Заявка уже подана')
            void navigate({ to: '/account', ignoreBlocker: true })
            return
          }
          setServerErrors(fields)
          setServerMissing(
            (Object.keys(fields) as RequiredField[]).filter(
              (field) => field in REQUIRED_PROFILE_FIELDS,
            ),
          )
          setFormError(errorMessage(code))
          focusFirstInvalid()
        })
    },
  })

  const isDirty = useStore(form.store, (state) => state.isDirty)
  const { dialog } = useUnsavedChangesGuard(isDirty)

  return (
    <Card className="grid gap-4">
      <section aria-labelledby="resubmit-profile" className="grid gap-3">
        <h2 id="resubmit-profile" className="text-xl font-bold">
          Данные из профиля
        </h2>
        <div className="flex min-w-0 items-center gap-3.5">
          <Avatar
            size="md"
            name={profile.gameNickname}
            src={profile.avatarUrl}
            alt={`Аватар ${profile.gameNickname}`}
          />
          <div className="min-w-0">
            <strong className="block break-words">
              {profile.gameNickname}
            </strong>
            <span className="text-muted-foreground">{profile.className}</span>
          </div>
        </div>
        <dl className={summaryClass}>
          <div>
            <dt>Имя</dt>
            <dd>{profile.displayName}</dd>
          </div>
          <div>
            <dt>Город</dt>
            <dd>{profile.city ?? '—'}</dd>
          </div>
          <div>
            <dt>Дата рождения</dt>
            <dd>{formatDate(profile.birthDate)}</dd>
          </div>
          <div className="col-span-full">
            <dt>О себе</dt>
            <dd className="whitespace-pre-line">{profile.about ?? '—'}</dd>
          </div>
        </dl>
        {missing.length > 0 ? (
          <Notice role="alert">
            Перед подачей заполните в личном кабинете:{' '}
            {missing.map((field) => REQUIRED_PROFILE_FIELDS[field]).join(', ')}.{' '}
            <Link to="/account" className="text-primary underline">
              Открыть кабинет
            </Link>
          </Notice>
        ) : (
          <p className="text-sm text-muted-foreground">
            Изменить эти данные можно в{' '}
            <Link to="/account" className="text-primary underline">
              личном кабинете
            </Link>
            .
          </p>
        )}
      </section>

      <form
        noValidate
        className="grid gap-4 border-t border-border pt-4"
        aria-label="Новая заявка"
        onSubmit={(event) => {
          event.preventDefault()
          void form.handleSubmit()
        }}
      >
        <form.Subscribe selector={(state) => state.submissionAttempts > 0}>
          {(submitted) => (
            <form.Field name="equipmentLinks">
              {(field) => {
                const errors = field.state.value.map((_link, index) => {
                  const server = serverErrors[`equipmentLinks.${index}`]
                  if (server) {
                    return fieldMessage(server)
                  }
                  if (!submitted) {
                    return null
                  }
                  const meta = form.getFieldMeta(`equipmentLinks[${index}]`)
                  const issue = meta?.errors.find(Boolean) as
                    { message?: string } | string | undefined
                  const message =
                    typeof issue === 'string' ? issue : issue?.message
                  return message ? fieldMessage(message) : null
                })
                return (
                  <fieldset className={fieldClass}>
                    <legend className={cn(formLabelClass, 'mb-2')}>
                      Скриншоты снаряжения
                    </legend>
                    <EquipmentLinks
                      idPrefix="resubmit-link"
                      links={field.state.value}
                      errors={errors}
                      onChange={(links) => {
                        setServerErrors({})
                        field.handleChange(links)
                      }}
                    />
                  </fieldset>
                )
              }}
            </form.Field>
          )}
        </form.Subscribe>
        <FormError message={formError} />
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(submitting) => (
            <Button
              type="submit"
              className="w-full"
              disabled={submitting || missing.length > 0}
            >
              {submitting ? 'Отправляем…' : 'Подать заявку'}
            </Button>
          )}
        </form.Subscribe>
      </form>
      {dialog}
    </Card>
  )
}

/**
 * Новая заявка после отказа (APP-10, Q-37): из прежней ничего не переносится,
 * данные берутся из текущего профиля, ссылки вводятся заново.
 */
export function ResubmitPage() {
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
  if (!me.data.canResubmit) {
    return <Navigate to="/account" />
  }
  return (
    <section className="mx-auto w-full max-w-[620px]">
      <PageHeader
        title="Новая заявка"
        description="Прежняя заявка отклонена. Проверьте данные профиля и при желании добавьте ссылки на снаряжение."
      />
      <ResubmitForm me={me.data} />
    </section>
  )
}
