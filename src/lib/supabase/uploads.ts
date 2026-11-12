import { AppError, type ClientErrorCode } from '@/lib/errors'
import { requireSupabase } from './client'

type SignedUpload = { bucket: string; path: string; token: string }

/**
 * Загружает файл по подписанной ссылке, выданной функцией `api` после
 * проверки прав. Отказ Storage — ошибка `rejected` (по умолчанию
 * `avatar_invalid`): файл не принят.
 */
export async function uploadToSignedUrl(
  upload: SignedUpload,
  file: Blob,
  rejected: ClientErrorCode = 'avatar_invalid',
) {
  const { error } = await requireSupabase()
    .storage.from(upload.bucket)
    .uploadToSignedUrl(upload.path, upload.token, file, {
      contentType: file.type,
    })
  if (error) {
    throw new AppError(rejected)
  }
}
