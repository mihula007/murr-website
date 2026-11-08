import { AVATAR_TYPES, LIMITS, type AvatarType } from '@contracts/account'

export class AvatarError extends Error {}

/** Размер после уменьшения до 512 px по большей стороне без увеличения (ACC-08). */
export function targetSize(
  width: number,
  height: number,
  max = LIMITS.avatarSide,
) {
  const scale = Math.min(1, max / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

export function isAvatarType(type: string): type is AvatarType {
  return (AVATAR_TYPES as readonly string[]).includes(type)
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, quality),
  )
}

/**
 * Готовит аватар к загрузке: проверяет тип, уменьшает, кодирует в WebP (или
 * JPEG, если браузер не умеет WebP) и следит за лимитом 500 КБ (Q-11).
 */
export async function compressAvatar(file: File): Promise<Blob> {
  if (!isAvatarType(file.type)) {
    throw new AvatarError('Нужен файл JPEG, PNG или WebP')
  }
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new AvatarError('Не удалось прочитать изображение')
  })
  const size = targetSize(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, size.width, size.height)
  bitmap.close()
  for (const quality of [0.86, 0.72, 0.55]) {
    let blob = await toBlob(canvas, 'image/webp', quality)
    if (!blob || blob.type !== 'image/webp') {
      blob = await toBlob(canvas, 'image/jpeg', quality)
    }
    if (blob && isAvatarType(blob.type) && blob.size <= LIMITS.avatarBytes) {
      return blob
    }
  }
  throw new AvatarError('Изображение слишком большое: максимум 500 КБ')
}
