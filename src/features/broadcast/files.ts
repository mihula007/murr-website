import {
  BROADCAST_LIMITS,
  isAllowedFileName,
  type BroadcastAttachment,
} from '@contracts/broadcasts'

/** Выбранный файл: только метаданные (BRC-09), содержимое не хранится. */
export type PickedFile = BroadcastAttachment & { lastModified: number }

export type FileRejection = {
  name: string
  reason: 'file_type' | 'file_too_large' | 'too_many'
}

const REASON_TEXT: Record<FileRejection['reason'], string> = {
  file_type: 'неподдерживаемый тип',
  file_too_large: 'больше 20 МБ',
  too_many: 'больше 10 файлов',
}

export function rejectionText(rejection: FileRejection) {
  return `${rejection.name}: ${REASON_TEXT[rejection.reason]}`
}

/**
 * Добавляет файлы по правилам BRC-08: до 10, каждый ≤ 20 МиБ, только
 * разрешённые типы; повтор (имя, размер, время изменения) пропускается молча.
 */
export function addFiles(
  current: readonly PickedFile[],
  incoming: readonly Pick<File, 'name' | 'size' | 'type' | 'lastModified'>[],
) {
  const accepted = [...current]
  const rejected: FileRejection[] = []
  for (const file of incoming) {
    const duplicate = accepted.some(
      (item) =>
        item.name === file.name &&
        item.size === file.size &&
        item.lastModified === file.lastModified,
    )
    if (duplicate) {
      continue
    }
    if (!isAllowedFileName(file.name)) {
      rejected.push({ name: file.name, reason: 'file_type' })
    } else if (file.size > BROADCAST_LIMITS.fileBytes || file.size === 0) {
      rejected.push({ name: file.name, reason: 'file_too_large' })
    } else if (accepted.length >= BROADCAST_LIMITS.files) {
      rejected.push({ name: file.name, reason: 'too_many' })
    } else {
      accepted.push({
        name: file.name.slice(0, BROADCAST_LIMITS.fileName),
        size: file.size,
        type: file.type.slice(0, BROADCAST_LIMITS.fileType),
        lastModified: file.lastModified,
      })
    }
  }
  return { accepted, rejected }
}

/** Размер для людей: КБ или МБ. */
export function formatSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} КБ`
    : `${(bytes / 1024 / 1024).toFixed(1)} МБ`
}
