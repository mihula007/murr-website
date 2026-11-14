import type { ReactNode } from 'react'
import { useForm, useStore } from '@tanstack/react-form'
import { z } from 'zod'
import type { AccountListItem } from '@contracts/accounts'
import { ROLE_LABELS } from '@/app/access'
import { focusFirstInvalid } from '@/components/form/focus-first-invalid'
import { FormError } from '@/components/form/form-error'
import { FormField, fieldError } from '@/components/form/form-field'
import { PasswordInput } from '@/components/form/password-input'
import { ErrorState } from '@/components/states/error-state'
import { LoadingState } from '@/components/states/loading-state'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toaster'
import { APPLICATION_STATUS } from '@/features/account/status-labels'
import { newPasswordSchema, PASSWORD_HINT } from '@/features/auth/schemas'
import { CharacterStatsFields } from './character-stats-fields'
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard'
import { formErrorMessage } from '@/lib/errors'
import { formatDate, formatDateMsk } from '@/lib/format-date'
import { useAccountCard, useDeleteAccount, useSetPassword } from './api'

type DialogProps = {
  account: AccountListItem | null
  onOpenChange: (open: boolean) => void
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="m-0 break-words">{children || '—'}</dd>
    </div>
  )
}

/** Все данные аккаунта для администратора (ADM-03). */
export function AccountCardDialog({ account, onOpenChange }: DialogProps) {
  const card = useAccountCard(account?.id ?? null)
  let content
  if (card.isPending) {
    content = <LoadingState label="Загружаем карточку…" rows={3} />
  } else if (card.isError) {
    content = <ErrorState onRetry={() => void card.refetch()} />
  } else {
    const data = card.data
    content = (
      <div className="grid gap-4">
        <div className="flex items-center gap-3">
          <Avatar
            size="md"
            name={data.gameNickname}
            src={data.avatarUrl}
            alt=""
          />
          <div className="grid min-w-0">
            <strong className="text-lg break-words">{data.gameNickname}</strong>
            <span className="text-sm text-muted-foreground">
              {ROLE_LABELS[data.role]}
              {data.isPrimaryAdmin ? ' · основной' : ''}
            </span>
          </div>
        </div>
        <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3 max-[520px]:grid-cols-1">
          <Row label="Имя">{data.displayName}</Row>
          <Row label="Email">
            <span className="break-all">{data.email}</span>
          </Row>
          <Row label="Класс">{data.className}</Row>
          <Row label="Город">{data.city}</Row>
          <Row label="Дата рождения">{formatDate(data.birthDate)}</Row>
          <Row label="Регистрация">{formatDateMsk(data.registeredAt)}</Row>
          <Row label="Вступление">{formatDate(data.joinedOn)}</Row>
          <Row label="Заявка">
            {data.applicationStatus
              ? APPLICATION_STATUS[data.applicationStatus].label
              : null}
          </Row>
          <Row label="Пароль">{data.passwordSet ? 'Задан' : 'Не задан'}</Row>
        </dl>
        <Row label="О себе">
          {data.about ? (
            <span className="whitespace-pre-line">{data.about}</span>
          ) : null}
        </Row>
        <div className="grid gap-1">
          <span className="text-xs text-muted-foreground">
            Скриншоты снаряжения (внешние ссылки)
          </span>
          {data.equipmentLinks.length === 0 ? (
            <span>—</span>
          ) : (
            <ul className="m-0 grid list-none gap-1 p-0">
              {data.equipmentLinks.map((url) => (
                <li key={url} className="break-all">
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="text-primary underline"
                  >
                    {url}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
        <CharacterStatsFields accountId={data.id} stats={data} />
      </div>
    )
  }
  return (
    <Dialog open={account !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Карточка аккаунта</DialogTitle>
          <DialogDescription>
            Данные видит только администратор.
          </DialogDescription>
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  )
}

const passwordSchema = z
  .object({ password: newPasswordSchema, repeat: z.string() })
  .refine((value) => value.repeat === value.password, {
    message: 'password_mismatch',
    path: ['repeat'],
  })

function PasswordForm({
  account,
  onDone,
}: {
  account: AccountListItem
  onDone: () => void
}) {
  const setPassword = useSetPassword()
  const form = useForm({
    defaultValues: { password: '', repeat: '' },
    validators: { onChange: passwordSchema },
    onSubmitInvalid: focusFirstInvalid,
    onSubmit: async ({ value }) => {
      const input = passwordSchema.parse(value)
      await setPassword
        .mutateAsync({ userId: account.id, password: input.password })
        .then(() => {
          form.reset()
          toast(`${account.gameNickname}: пароль изменён, сеансы завершены`)
          onDone()
        })
        .catch(focusFirstInvalid)
    },
  })
  const isDirty = useStore(form.store, (state) => state.isDirty)
  const { dialog } = useUnsavedChangesGuard(isDirty)
  const fields = [
    { name: 'password', id: 'admin-password', label: 'Новый пароль' },
    { name: 'repeat', id: 'admin-password-repeat', label: 'Повторите пароль' },
  ] as const

  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <form.Subscribe selector={(state) => state.submissionAttempts > 0}>
        {(submitted) =>
          fields.map(({ name, id, label }) => (
            <form.Field key={name} name={name}>
              {(field) => {
                const error = fieldError(
                  field.state.meta,
                  submitted,
                  setPassword.error?.fields[name],
                )
                const hint = name === 'password' ? PASSWORD_HINT : undefined
                return (
                  <FormField id={id} label={label} error={error} hint={hint}>
                    <PasswordInput
                      id={id}
                      autoComplete="new-password"
                      value={field.state.value}
                      onChange={field.handleChange}
                      onBlur={field.handleBlur}
                      error={error}
                      hint={hint}
                    />
                  </FormField>
                )
              }}
            </form.Field>
          ))
        }
      </form.Subscribe>
      <FormError message={formErrorMessage(setPassword.error)} />
      <DialogFooter>
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(submitting) => (
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Меняем…' : 'Сменить пароль'}
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
      {dialog}
    </form>
  )
}

/** Новый пароль другого аккаунта (ADM-07, Q-72). */
export function PasswordDialog({ account, onOpenChange }: DialogProps) {
  return (
    <Dialog open={account !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Пароль {account?.gameNickname}</DialogTitle>
          <DialogDescription>
            Все сеансы пользователя завершатся: войти можно будет только с новым
            паролем. Пароль не попадает в журнал.
          </DialogDescription>
        </DialogHeader>
        {account ? (
          <PasswordForm account={account} onDone={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

/** Что происходит с данными при удалении (ADM-08, таблица этапа 11). */
const CONSEQUENCES = [
  'Профиль, заявки, аватар, ответы на события, места в группах, итоги посещения, черновики, шаблоны и личные уведомления удаляются.',
  'События, голосования, опубликованные материалы и сообщения остаются с подписью «Пользователь удалён».',
  'Голоса и реакции остаются без связи с пользователем.',
  'В журнал записываются ник и email удалённого.',
]

function DeleteForm({
  account,
  onDone,
}: {
  account: AccountListItem
  onDone: () => void
}) {
  const remove = useDeleteAccount()
  const schema = z.object({
    confirmNickname: z
      .string()
      .trim()
      .refine((value) => value === account.gameNickname, 'nickname_mismatch'),
  })
  const form = useForm({
    defaultValues: { confirmNickname: '' },
    validators: { onChange: schema },
    onSubmitInvalid: focusFirstInvalid,
    onSubmit: async ({ value }) => {
      await remove
        .mutateAsync({
          userId: account.id,
          confirmNickname: value.confirmNickname.trim(),
        })
        .then(() => {
          form.reset()
          toast(`${account.gameNickname}: пользователь удалён`)
          onDone()
        })
        .catch(focusFirstInvalid)
    },
  })
  const id = 'delete-confirm-nickname'

  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <ul className="m-0 grid gap-1.5 pl-5 text-sm text-muted-foreground">
        {CONSEQUENCES.map((text) => (
          <li key={text}>{text}</li>
        ))}
      </ul>
      <form.Subscribe selector={(state) => state.submissionAttempts > 0}>
        {(submitted) => (
          <form.Field name="confirmNickname">
            {(field) => {
              const error = fieldError(
                field.state.meta,
                submitted,
                remove.error?.fields.confirmNickname,
              )
              return (
                <FormField
                  id={id}
                  label={`Введите ник «${account.gameNickname}» для подтверждения`}
                  error={error}
                >
                  <Input
                    id={id}
                    autoComplete="off"
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    onBlur={field.handleBlur}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? `${id}-error` : undefined}
                  />
                </FormField>
              )
            }}
          </form.Field>
        )}
      </form.Subscribe>
      <FormError message={formErrorMessage(remove.error)} />
      <DialogFooter>
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(submitting) => (
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Удаляем…' : 'Удалить навсегда'}
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  )
}

/** Безвозвратное удаление пользователя или его повтор (Q-73, Q-74). */
export function DeleteAccountDialog({ account, onOpenChange }: DialogProps) {
  return (
    <Dialog open={account !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Удалить {account?.gameNickname} навсегда?</DialogTitle>
          <DialogDescription>
            {account?.email}. Действие необратимо; блокировка (роль «Чтец»)
            сохраняет аккаунт и выполняется сменой роли.
          </DialogDescription>
        </DialogHeader>
        {account ? (
          <DeleteForm account={account} onDone={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
