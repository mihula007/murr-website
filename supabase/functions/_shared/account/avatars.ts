import { LIMITS, type AvatarType } from '../contracts/account.ts'
import { ApiError } from '../http/errors.ts'
import type { StorageGateway } from '../storage/gateway.ts'
import { detectImageType } from '../storage/image.ts'

export const AVATAR_BUCKET = 'avatars'
const EXTENSIONS: Record<AvatarType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}
const SIGNED_URL_SECONDS = 3600

export function newAvatarPath(userId: string, type: AvatarType) {
  return `${userId}/${crypto.randomUUID()}.${EXTENSIONS[type]}`
}

/** Файл лежит в папке пользователя, не больше 500 KB и по сигнатуре — изображение. */
export async function verifyAvatar(
  storage: StorageGateway,
  userId: string,
  path: string,
) {
  const [folder, name, ...rest] = path.split('/')
  if (folder !== userId || !name || rest.length > 0 || name.startsWith('.')) {
    throw new ApiError('avatar_invalid')
  }
  const file = await storage.read(AVATAR_BUCKET, path)
  if (!file || file.size === 0 || file.size > LIMITS.avatarBytes) {
    throw new ApiError('avatar_invalid')
  }
  if (!detectImageType(file.head)) {
    throw new ApiError('avatar_invalid')
  }
}

/** Удаляет из папки пользователя всё, кроме текущего аватара. Ошибка не критична. */
export async function cleanupAvatarFolder(
  storage: StorageGateway,
  userId: string,
  keep: string | null,
) {
  try {
    const paths = await storage.list(AVATAR_BUCKET, userId)
    await storage.remove(
      AVATAR_BUCKET,
      paths.filter((path) => path !== keep),
    )
  } catch (error) {
    console.error('Не удалось очистить папку аватаров', error)
  }
}

export function avatarUrl(storage: StorageGateway, path: string | null) {
  return path
    ? storage.signedUrl(AVATAR_BUCKET, path, SIGNED_URL_SECONDS)
    : Promise.resolve(null)
}

/** Ссылки на аватары списка одним запросом Storage: путь → ссылка. */
export function avatarUrls(storage: StorageGateway, paths: (string | null)[]) {
  const unique = [...new Set(paths.filter((path) => path !== null))]
  return storage.signedUrls(AVATAR_BUCKET, unique, SIGNED_URL_SECONDS)
}
