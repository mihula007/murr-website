import type {
  AvatarUploadResponse,
  MeResponse,
  RegistrationFields,
} from '@contracts/account'
import { ApiCallError, callApi } from '@/lib/api/client'
import { clearDraft } from './registration-draft'
import { requireSupabase } from './supabase-auth'

/** Загружает аватар по подписанной ссылке и возвращает путь в Storage. */
export async function uploadAvatar(avatar: Blob) {
  const upload = await callApi<AvatarUploadResponse>('account/avatar-upload', {
    contentType: avatar.type,
  })
  const { error } = await requireSupabase()
    .storage.from(upload.bucket)
    .uploadToSignedUrl(upload.path, upload.token, avatar, {
      contentType: avatar.type,
    })
  if (error) throw new ApiCallError('avatar_invalid')
  return upload.path
}

/**
 * Шаги 5–6 регистрации: аватар, затем одна идемпотентная операция сервера.
 * Повтор после сбоя безопасен. Черновик очищается только после успеха.
 */
export async function finishRegistration(
  fields: RegistrationFields,
  avatar: Blob,
) {
  const avatarPath = await uploadAvatar(avatar)
  const me = await callApi<MeResponse>('account/complete-registration', {
    ...fields,
    avatarPath,
  })
  if (me.state === 'ready') clearDraft()
  return me
}
