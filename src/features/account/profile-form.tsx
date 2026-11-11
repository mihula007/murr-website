import { useState } from 'react'
import { useForm, useStore } from '@tanstack/react-form'
import { useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import {
  LIMITS,
  birthDateSchema,
  classIdSchema,
  displayNameSchema,
  gameNicknameSchema,
  type MeResponse,
  type ProfileView,
} from '@contracts/account'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { toast } from '@/components/ui/toaster'
import { AvatarError, compressAvatar } from '@/features/auth/compress-avatar'
import { uploadAvatar } from '@/features/auth/finish-registration'
import { useSession } from '@/features/auth/session'
import { meQueryKey } from '@/features/auth/use-me'
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard'
import { ApiCallError, callApi } from '@/lib/api/client'
import { errorMessage, fieldMessage } from '@/lib/api/messages'
import { FormError } from './auth-layout'
import { focusFirstInvalid } from './focus'
import {
  AvatarPicker,
  ClassSelect,
  FormField,
  fieldAria,
  fieldError,
  formGridClass,
  subformClass,
} from './form-controls'

const profileSchema = z.object({
  displayName: displayNameSchema,
  gameNickname: gameNicknameSchema,
  city: z.string().trim().max(LIMITS.city, 'too_long'),
  birthDate: z.union([z.literal(''), birthDateSchema]),
  classId: classIdSchema,
  about: z.string().trim().max(LIMITS.about, 'too_long'),
})

type AvatarChange =
  { action: 'keep' } | { action: 'remove' } | { action: 'replace'; file: Blob }

type ProfileFormProps = {
  profile: ProfileView
  email: string
  onDone: () => void
}

/** Редактирование своего профиля (ACC-06–08, Q-27, Q-31). Email только для чтения. */
export function ProfileForm({ profile, email, onDone }: ProfileFormProps) {
  const queryClient = useQueryClient()
  const session = useSession()
  const [avatar, setAvatar] = useState<AvatarChange>({ action: 'keep' })
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)

  const form = useForm({
    defaultValues: {
      displayName: profile.displayName,
      gameNickname: profile.gameNickname,
      city: profile.city ?? '',
      birthDate: profile.birthDate ?? '',
      classId: profile.classId,
      about: profile.about ?? '',
    },
    validators: { onChange: profileSchema },
    onSubmitInvalid: focusFirstInvalid,
    onSubmit: async ({ value }) => {
      setFormError(null)
      const input = profileSchema.parse(value)
      try {
        const avatarChange =
          avatar.action === 'replace'
            ? {
                action: 'replace' as const,
                path: await uploadAvatar(avatar.file),
              }
            : avatar
        const me = await callApi<MeResponse>('account/update-profile', {
          ...input,
          city: input.city || null,
          birthDate: input.birthDate || null,
          about: input.about || null,
          avatar: avatarChange,
        })
        queryClient.setQueryData(meQueryKey(session.session?.user.id), me)
        toast('Личная информация сохранена')
        form.reset()
        setAvatar({ action: 'keep' })
        onDone()
      } catch (error) {
        if (!(error instanceof ApiCallError)) {
          setFormError(errorMessage('network'))
          return
        }
        if (error.code === 'avatar_invalid') {
          setAvatarError(fieldMessage('avatar_invalid'))
          return
        }
        setServerErrors(error.code === 'validation_failed' ? error.fields : {})
        setFormError(errorMessage(error.code))
      }
    },
  })

  const isDirty = useStore(form.store, (state) => state.isDirty)
  const { dialog } = useUnsavedChangesGuard(isDirty || avatar.action !== 'keep')

  async function selectAvatar(file: File) {
    setAvatarBusy(true)
    setAvatarError(null)
    try {
      setAvatar({ action: 'replace', file: await compressAvatar(file) })
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

  const clearServer = (name: string) =>
    setServerErrors(({ [name]: _removed, ...rest }) => rest)

  return (
    <form
      noValidate
      className={subformClass}
      aria-labelledby="profile-form-title"
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <h3 id="profile-form-title" className="text-lg font-bold">
        Личная информация
      </h3>
      <form.Subscribe selector={(state) => state.submissionAttempts > 0}>
        {(submitted) => (
          <div className={formGridClass}>
            <FormField
              id="profile-avatar"
              label="Аватар"
              error={avatarError}
              hint={
                avatarBusy
                  ? 'Готовим изображение…'
                  : 'JPEG, PNG или WebP до 500 КБ'
              }
              className="col-span-full"
            >
              <AvatarPicker
                id="profile-avatar"
                file={avatar.action === 'replace' ? avatar.file : null}
                currentUrl={
                  avatar.action === 'remove' ? null : profile.avatarUrl
                }
                fallback={profile.gameNickname.slice(0, 1).toUpperCase()}
                busy={avatarBusy}
                error={avatarError}
                onSelect={(file) => void selectAvatar(file)}
                onRemove={() => {
                  setAvatarError(null)
                  setAvatar({ action: 'remove' })
                }}
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
                  <FormField id="profile-name" label="Имя" error={error}>
                    <Input
                      {...fieldAria('profile-name', error)}
                      maxLength={LIMITS.displayName}
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
            <form.Field name="gameNickname">
              {(field) => {
                const error = fieldError(
                  field.state.meta,
                  submitted,
                  serverErrors.gameNickname,
                )
                return (
                  <FormField
                    id="profile-nickname"
                    label="Игровой никнейм"
                    error={error}
                    hint="До 9 символов, регистр важен"
                  >
                    <Input
                      {...fieldAria('profile-nickname', error, true)}
                      maxLength={LIMITS.gameNickname}
                      value={field.state.value}
                      onChange={(event) => {
                        clearServer('gameNickname')
                        field.handleChange(event.target.value)
                      }}
                      onBlur={field.handleBlur}
                    />
                  </FormField>
                )
              }}
            </form.Field>
            <FormField
              id="profile-email"
              label="Электронная почта"
              hint="Используется для входа и не меняется"
            >
              <Input
                {...fieldAria('profile-email', null, true)}
                type="email"
                value={email}
                readOnly
                className="opacity-80"
              />
            </FormField>
            <form.Field name="city">
              {(field) => {
                const error = fieldError(
                  field.state.meta,
                  submitted,
                  serverErrors.city,
                )
                return (
                  <FormField id="profile-city" label="Город" error={error}>
                    <Input
                      {...fieldAria('profile-city', error)}
                      maxLength={LIMITS.city}
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
                    id="profile-class"
                    label="Класс персонажа"
                    error={error}
                  >
                    <ClassSelect
                      id="profile-class"
                      value={field.state.value}
                      error={error}
                      onChange={field.handleChange}
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
                  <FormField
                    id="profile-birth"
                    label="Дата рождения"
                    error={error}
                  >
                    <Input
                      {...fieldAria('profile-birth', error)}
                      type="date"
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
            <form.Field name="about">
              {(field) => {
                const error = fieldError(
                  field.state.meta,
                  submitted,
                  serverErrors.about,
                )
                return (
                  <FormField
                    id="profile-about"
                    label="О себе"
                    error={error}
                    hint={`${field.state.value.length} / ${LIMITS.about}`}
                    className="col-span-full"
                  >
                    <Textarea
                      {...fieldAria('profile-about', error, true)}
                      rows={4}
                      maxLength={LIMITS.about}
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
          </div>
        )}
      </form.Subscribe>
      <FormError message={formError} />
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(submitting) => (
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={submitting || avatarBusy}>
              {submitting ? 'Сохраняем…' : 'Сохранить профиль'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                form.reset()
                setAvatar({ action: 'keep' })
                onDone()
              }}
            >
              Отмена
            </Button>
          </div>
        )}
      </form.Subscribe>
      {dialog}
    </form>
  )
}
