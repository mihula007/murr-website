import type { AvatarUploadResponse } from '@contracts/account'
import { callApi } from '@/lib/supabase/api'
import { uploadToSignedUrl } from '@/lib/supabase/uploads'

/** Загружает аватар по подписанной ссылке и возвращает путь в Storage. */
export async function uploadAvatar(avatar: Blob) {
  const upload = await callApi<AvatarUploadResponse>('account/avatar-upload', {
    contentType: avatar.type,
  })
  await uploadToSignedUrl(upload, avatar)
  return upload.path
}
