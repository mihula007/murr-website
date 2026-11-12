import {
  PUBLICATION_FILE_LIMITS,
  PUBLICATION_FILE_TYPES,
  type PublicationFileType,
} from '@contracts/publications'

export class ImageFileError extends Error {}

/** Наибольшая сторона после уменьшения слишком тяжёлого изображения. */
const MAX_SIDE = 2048

export function isPublicationFileType(
  type: string,
): type is PublicationFileType {
  return (PUBLICATION_FILE_TYPES as readonly string[]).includes(type)
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, quality),
  )
}

/**
 * Вложение публикации (PUB-13, Q-11): JPEG, PNG или WebP до 1 МБ. Файл в
 * пределах лимита загружается как есть; больший — уменьшается и кодируется
 * в WebP (или JPEG). Остальные типы отклоняются сразу.
 */
export async function prepareImage(file: File): Promise<Blob> {
  if (!isPublicationFileType(file.type)) {
    throw new ImageFileError(
      `«${file.name}»: можно прикрепить только JPEG, PNG или WebP`,
    )
  }
  if (file.size <= PUBLICATION_FILE_LIMITS.bytes) {
    return file
  }
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new ImageFileError(`«${file.name}»: не удалось прочитать изображение`)
  })
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  for (const quality of [0.86, 0.72, 0.55]) {
    let blob = await toBlob(canvas, 'image/webp', quality)
    if (!blob || blob.type !== 'image/webp') {
      blob = await toBlob(canvas, 'image/jpeg', quality)
    }
    if (
      blob &&
      isPublicationFileType(blob.type) &&
      blob.size <= PUBLICATION_FILE_LIMITS.bytes
    ) {
      return blob
    }
  }
  throw new ImageFileError(`«${file.name}»: изображение больше 1 МБ`)
}
