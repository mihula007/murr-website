import {
  PUBLICATION_FILE_LIMITS,
  type PublicationFileType,
} from '../contracts/publications.ts'
import { ApiError } from '../http/errors.ts'
import type { StorageGateway } from '../storage/gateway.ts'
import { detectImageType } from '../storage/image.ts'

/** Приватный bucket изображений публикаций (Q-11, PUB-13). */
export const PUBLICATION_BUCKET = 'publication-images'
const SIGNED_URL_SECONDS = 3600
/** Непривязанная загрузка старше суток считается брошенной (PUB-16). */
const STALE_UPLOAD_MS = 24 * 60 * 60 * 1000

const EXTENSIONS: Record<PublicationFileType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/** Папка загрузок пользователя. Время в имени — для очистки брошенных. */
export const uploadFolder = (userId: string) => `uploads/${userId}`

export function newUploadPath(
  userId: string,
  type: PublicationFileType,
  now: Date,
) {
  return `${uploadFolder(userId)}/${now.getTime()}-${crypto.randomUUID()}.${EXTENSIONS[type]}`
}

/** Путь из папки загрузок этого пользователя, без лишних сегментов. */
export function isOwnUploadPath(userId: string, path: string) {
  const [root, folder, name, ...rest] = path.split('/')
  return (
    root === 'uploads' &&
    folder === userId &&
    !!name &&
    rest.length === 0 &&
    /^\d{1,15}-[0-9a-f-]{36}\.(jpg|png|webp)$/.test(name)
  )
}

/** Момент загрузки из имени файла; null — имя не нашего формата. */
function uploadedAt(path: string) {
  const match = /\/(\d{1,15})-[^/]+$/.exec(path)
  return match ? Number(match[1]) : null
}

/**
 * Файл новой загрузки: своя папка, не больше 1 МБ, по сигнатуре — JPEG, PNG
 * или WebP (не по расширению и не по заявленному MIME).
 */
export async function verifyUpload(
  storage: StorageGateway,
  userId: string,
  path: string,
): Promise<{ size: number; contentType: PublicationFileType }> {
  if (!isOwnUploadPath(userId, path)) {
    throw new ApiError('publication_file_invalid')
  }
  const file = await storage.read(PUBLICATION_BUCKET, path)
  if (!file || file.size === 0 || file.size > PUBLICATION_FILE_LIMITS.bytes) {
    throw new ApiError('publication_file_invalid')
  }
  const contentType = detectImageType(file.head)
  if (!contentType) {
    throw new ApiError('publication_file_invalid')
  }
  return { size: file.size, contentType }
}

/** Ссылки на вложения одним запросом Storage: путь → ссылка. */
export function attachmentUrls(storage: StorageGateway, paths: string[]) {
  return storage.signedUrls(
    PUBLICATION_BUCKET,
    [...new Set(paths)],
    SIGNED_URL_SECONDS,
  )
}

/** Удаление файлов после коммита: ошибка Storage не отменяет действие. */
export async function removeFiles(storage: StorageGateway, paths: string[]) {
  if (paths.length === 0) {
    return
  }
  try {
    await storage.remove(PUBLICATION_BUCKET, paths)
  } catch (error) {
    console.error('Не удалось удалить файлы публикации', error)
  }
}

/** Файлы папки загрузок пользователя старше суток. */
export async function staleUploads(
  storage: StorageGateway,
  userId: string,
  now: Date,
) {
  try {
    const paths = await storage.list(PUBLICATION_BUCKET, uploadFolder(userId))
    return paths.filter((path) => {
      const at = uploadedAt(path)
      return at !== null && now.getTime() - at > STALE_UPLOAD_MS
    })
  } catch (error) {
    console.error('Не удалось прочитать папку загрузок', error)
    return []
  }
}
