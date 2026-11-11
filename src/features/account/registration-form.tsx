import { useState } from 'react'
import { useForm, useStore } from '@tanstack/react-form'
import { z } from 'zod'
import {
  LIMITS,
  registrationFieldsSchema,
  type RegistrationFields,
} from '@contracts/account'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { fieldClass } from '@/components/ui/surfaces'
import { AvatarError, compressAvatar } from '@/features/auth/compress-avatar'
import {
  saveDraft,
  type RegistrationDraft,
} from '@/features/auth/registration-draft'
import { useSession } from '@/features/auth/session'
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard'
import { callApi } from '@/lib/api/client'
import { fieldMessage } from '@/lib/api/messages'
import { cn } from '@/lib/utils'
import { FormError } from './auth-layout'
import { focusFirstInvalid } from './focus'
import {
  AvatarPicker,
  ClassSelect,
  EquipmentLinks,
  FormField,
  FormSectionTitle,
  PasswordInput,
  fieldAria,
  fieldError,
  formGridClass,
  formLabelClass,
} from './form-controls'

export const accountFieldsSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('invalid_email')),
  password: z.string().min(LIMITS.passwordMin, 'password_short'),
})

const registerSchema = registrationFieldsSchema.extend(
  accountFieldsSchema.shape,
)
const completeSchema = registrationFieldsSchema.extend({
  email: z.string(),
  password: z.string(),
})

export type RegistrationValues = RegistrationFields & {
  email: string
  password: string
}

/** Ответ обработчика отправки: ошибки полей, аватара или всей формы. */
export type SubmitProblem = {
  fields?: Record<string, string>
  avatar?: string
  form?: string
}

type RegistrationFormProps = {
  mode: 'register' | 'complete'
  draft: RegistrationDraft | null
  initialAvatar?: Blob | null
  submitLabel: string
  onAvatarChange?: (avatar: Blob | null) => void
  /** После успеха обработчик сам уходит со страницы с `ignoreBlocker`. */
  onSubmit: (
    values: RegistrationValues,
    avatar: Blob,
  ) => Promise<SubmitProblem | void>
}

/** Анкета регистрации (ACC-14, Q-15). В режиме complete — без email и пароля. */
export function RegistrationForm({
  mode,
  draft,
  initialAvatar = null,
  submitLabel,
  onAvatarChange,
  onSubmit,
}: RegistrationFormProps) {
  const session = useSession()
  const [avatar, setAvatar] = useState<Blob | null>(initialAvatar)
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)

  const form = useForm({
    defaultValues: {
      email: draft?.email ?? '',
      password: '',
      displayName: draft?.displayName ?? '',
      gameNickname: draft?.gameNickname ?? '',
      city: draft?.city ?? '',
      birthDate: draft?.birthDate ?? '',
      classId: draft?.classId ?? 0,
      about: draft?.about ?? '',
      equipmentLinks: draft?.equipmentLinks ?? [],
    },
    validators: {
      onChange: mode === 'register' ? registerSchema : completeSchema,
    },
    listeners: {
      // Черновик без пароля переживает перезагрузку вкладки (Q-28).
      onChange: ({ formApi }) => {
        const { password: _password, ...rest } = formApi.state.values
        saveDraft(
          mode === 'register'
            ? rest
            : { ...draft, ...rest, email: draft?.email ?? '' },
        )
      },
      onChangeDebounceMs: 300,
    },
    onSubmitInvalid: focusFirstInvalid,
    onSubmit: async ({ value }) => {
      setFormError(null)
      if (!avatar) {
        setAvatarError(fieldMessage('required'))
        return
      }
      const schema = mode === 'register' ? registerSchema : completeSchema
      const problem = await onSubmit(
        schema.parse(value) as RegistrationValues,
        avatar,
      )
      if (problem) {
        setServerErrors(problem.fields ?? {})
        if (problem.avatar) setAvatarError(problem.avatar)
        setFormError(
          problem.form ??
            (problem.fields ? 'Проверьте отмеченные поля.' : null),
        )
      }
    },
  })

  const isDirty = useStore(form.store, (state) => state.isDirty)
  const { dialog } = useUnsavedChangesGuard(isDirty)

  async function selectAvatar(file: File) {
    setAvatarBusy(true)
    setAvatarError(null)
    try {
      const prepared = await compressAvatar(file)
      setAvatar(prepared)
      onAvatarChange?.(prepared)
    } catch (error) {
      setAvatarError(
        error instanceof AvatarError
          ? error.message
          : fieldMessage('avatar_invalid'),
      )
    } finally {
      setAvatarBusy(false)
    }
  }

  async function checkNickname(value: string) {
    const nickname = value.trim()
    if (!nickname || nickname.length > LIMITS.gameNickname) return
    try {
      const result = await callApi<{ available: boolean }>(
        'account/check-nickname',
        {
          gameNickname: nickname,
        },
      )
      if (!result.available) {
        setServerErrors((current) => ({
          ...current,
          gameNickname: 'nickname_taken',
        }))
      }
    } catch {
      // Проверка — только подсказка; окончательно ник проверит сервер.
    }
  }

  const clearServer = (name: string) =>
    setServerErrors(({ [name]: _removed, ...rest }) => rest)

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
        {(submitted) => (
          <div className={formGridClass}>
            {mode === 'register' ? (
              <>
                <FormSectionTitle>Аккаунт</FormSectionTitle>
                <form.Field name="email">
                  {(field) => {
                    const error = fieldError(field.state.meta, submitted)
                    return (
                      <FormField
                        id="reg-email"
                        label="Логин (электронная почта)"
                        error={error}
                        className="col-span-full"
                      >
                        <Input
                          {...fieldAria('reg-email', error)}
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
                      <FormField
                        id="reg-password"
                        label="Пароль"
                        error={error}
                        className="col-span-full"
                      >
                        <PasswordInput
                          id="reg-password"
                          autoComplete="new-password"
                          placeholder="Минимум 8 символов"
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
            ) : null}

            <FormSectionTitle>Персонаж</FormSectionTitle>
            <FormField
              id="reg-avatar"
              label="Аватар"
              error={
                avatarError ??
                (submitted && !avatar ? fieldMessage('required') : null)
              }
              hint={
                avatarBusy
                  ? 'Готовим изображение…'
                  : 'JPEG, PNG или WebP до 500 КБ'
              }
              className="col-span-full"
            >
              <AvatarPicker
                id="reg-avatar"
                file={avatar}
                fallback="?"
                busy={avatarBusy}
                error={avatarError}
                onSelect={(file) => void selectAvatar(file)}
              />
            </FormField>
            <form.Field name="displayName">
              {(field) => {
                const error = fieldError(
                  field.state.meta,
                  submitted,
                  serverErrors.displayName,
                )
                return (
                  <FormField
                    id="reg-name"
                    label="Имя"
                    error={error}
                    hint={`До ${LIMITS.displayName} символов`}
                  >
                    <Input
                      {...fieldAria('reg-name', error, true)}
                      autoComplete="given-name"
                      maxLength={LIMITS.displayName}
                      placeholder="Как к тебе обращаться"
                      value={field.state.value}
                      onChange={(event) => {
                        clearServer('displayName')
                        field.handleChange(event.target.value)
                      }}
                      onBlur={field.handleBlur}
                    />
                  </FormField>
                )
              }}
            </form.Field>
            <form.Field name="gameNickname">
              {(field) => {
                const error = fieldError(
                  field.state.meta,
                  submitted,
                  serverErrors.gameNickname,
                )
                return (
                  <FormField
                    id="reg-nickname"
                    label="Игровой никнейм"
                    error={error}
                    hint={`До ${LIMITS.gameNickname} символов, регистр важен`}
                  >
                    <Input
                      {...fieldAria('reg-nickname', error, true)}
                      autoComplete="nickname"
                      maxLength={LIMITS.gameNickname}
                      placeholder="Ник персонажа"
                      value={field.state.value}
                      onChange={(event) => {
                        clearServer('gameNickname')
                        field.handleChange(event.target.value)
                      }}
                      onBlur={() => {
                        field.handleBlur()
                        void checkNickname(field.state.value)
                      }}
                    />
                  </FormField>
                )
              }}
            </form.Field>
            <form.Field name="city">
              {(field) => {
                const error = fieldError(
                  field.state.meta,
                  submitted,
                  serverErrors.city,
                )
                return (
                  <FormField id="reg-city" label="Город" error={error}>
                    <Input
                      {...fieldAria('reg-city', error)}
                      autoComplete="address-level2"
                      maxLength={LIMITS.city}
                      placeholder="Город проживания"
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
            <form.Field name="birthDate">
              {(field) => {
                const error = fieldError(
                  field.state.meta,
                  submitted,
                  serverErrors.birthDate,
                )
                return (
                  <FormField id="reg-birth" label="Дата рождения" error={error}>
                    <Input
                      {...fieldAria('reg-birth', error)}
                      type="date"
                      autoComplete="bday"
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
            <form.Field name="classId">
              {(field) => {
                const error = fieldError(
                  {
                    ...field.state.meta,
                    isBlurred: field.state.meta.isTouched,
                  },
                  submitted,
                  serverErrors.classId,
                )
                return (
                  <FormField
                    id="reg-class"
                    label="Класс персонажа"
                    error={error}
                    className="col-span-full"
                  >
                    <ClassSelect
                      id="reg-class"
                      value={field.state.value}
                      error={error}
                      onChange={(value) => {
                        clearServer('classId')
                        field.handleChange(value)
                      }}
                    />
                  </FormField>
                )
              }}
            </form.Field>

            <FormSectionTitle>О себе</FormSectionTitle>
            <form.Field name="about">
              {(field) => {
                const error = fieldError(
                  field.state.meta,
                  submitted,
                  serverErrors.about,
                )
                return (
                  <FormField
                    id="reg-about"
                    label="Рассказ о себе"
                    error={error}
                    hint={`${field.state.value.length} / ${LIMITS.about}`}
                    className="col-span-full"
                  >
                    <Textarea
                      {...fieldAria('reg-about', error, true)}
                      rows={5}
                      maxLength={LIMITS.about}
                      placeholder="Расскажи об опыте в игре и почему хочешь в клан"
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
            <form.Field name="equipmentLinks">
              {(field) => {
                const errors = field.state.value.map((_link, index) => {
                  const server = serverErrors[`equipmentLinks.${index}`]
                  if (server) return fieldMessage(server)
                  if (!submitted) return null
                  // Ошибки элементов массива TanStack Form хранит под `equipmentLinks[i]`.
                  const meta = form.getFieldMeta(`equipmentLinks[${index}]`)
                  const issue = meta?.errors.find(Boolean) as
                    { message?: string } | string | undefined
                  const message =
                    typeof issue === 'string' ? issue : issue?.message
                  return message ? fieldMessage(message) : null
                })
                return (
                  <fieldset className={cn(fieldClass, 'col-span-full')}>
                    <legend className={cn(formLabelClass, 'mb-2')}>
                      Скриншоты снаряжения
                    </legend>
                    <EquipmentLinks
                      idPrefix="reg-link"
                      links={field.state.value}
                      errors={errors}
                      onChange={field.handleChange}
                    />
                  </fieldset>
                )
              }}
            </form.Field>
          </div>
        )}
      </form.Subscribe>
      <FormError message={formError} />
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(submitting) => (
          <Button
            type="submit"
            className="w-full"
            disabled={
              submitting || avatarBusy || session.status === 'unavailable'
            }
          >
            {submitting ? 'Отправляем…' : submitLabel}
          </Button>
        )}
      </form.Subscribe>
      {dialog}
    </form>
  )
}
