import { z } from 'zod'

/**
 * Подготовка рассылок (BRC). Только черновики: интеграции с мессенджерами
 * делаются отдельно (Q-22), сайт ничего не отправляет (BRC-13).
 */
export const BROADCAST_CHANNELS = ['telegram', 'vk', 'max'] as const
export type BroadcastChannel = (typeof BROADCAST_CHANNELS)[number]

export const BROADCAST_CHANNEL_LABELS: Record<BroadcastChannel, string> = {
  telegram: 'Telegram',
  vk: 'ВКонтакте',
  max: 'MAX',
}

export const BROADCAST_LIMITS = {
  subject: 120,
  body: 4000,
  templateName: 60,
  /** Черновики — малый список (Q-69): хранится не больше 50 последних. */
  drafts: 50,
  /** Шаблоны — общие, не больше 20 (BRC-10, Q-70). */
  templates: 20,
  /** Вложения: до 10 файлов по 20 МиБ (BRC-08). */
  files: 10,
  fileBytes: 20 * 1024 * 1024,
  fileName: 200,
  fileType: 100,
} as const

/** Разрешённые расширения вложений (BRC-08). Тип браузера бывает пустым. */
export const BROADCAST_FILE_EXTENSIONS = [
  'xls',
  'xlsx',
  'doc',
  'docx',
  'txt',
  'rtf',
  'odt',
  'ods',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
] as const

export const BROADCAST_SOURCES = ['event', 'vote', 'group'] as const
export type BroadcastSource = (typeof BROADCAST_SOURCES)[number]

export function fileExtension(name: string) {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function isAllowedFileName(name: string) {
  return (BROADCAST_FILE_EXTENSIONS as readonly string[]).includes(
    fileExtension(name),
  )
}

const optionalSubject = z
  .string()
  .trim()
  .max(BROADCAST_LIMITS.subject, 'too_long')
  .nullish()
  .transform((value) => value || null)

const bodySchema = z
  .string('required')
  .trim()
  .min(1, 'required')
  .max(BROADCAST_LIMITS.body, 'too_long')

/** Хотя бы один канал (BRC-06); повторы схлопываются. */
export const channelsSchema = z
  .array(z.enum(BROADCAST_CHANNELS, 'invalid'), 'required')
  .min(1, 'required')
  .transform((items) => BROADCAST_CHANNELS.filter((c) => items.includes(c)))

/** Только метаданные файла: содержимое не хранится (BRC-09). */
export const attachmentSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'invalid')
    .max(BROADCAST_LIMITS.fileName, 'too_long')
    .refine(isAllowedFileName, 'file_type'),
  size: z
    .number()
    .int()
    .min(1, 'invalid')
    .max(BROADCAST_LIMITS.fileBytes, 'file_too_large'),
  type: z.string().max(BROADCAST_LIMITS.fileType, 'invalid'),
})
export type BroadcastAttachment = z.output<typeof attachmentSchema>

export const saveDraftSchema = z.object({
  subject: optionalSubject,
  body: bodySchema,
  channels: channelsSchema,
  attachments: z
    .array(attachmentSchema)
    .max(BROADCAST_LIMITS.files, 'too_many')
    .default([]),
  source: z
    .object({
      kind: z.enum(BROADCAST_SOURCES, 'invalid'),
      id: z.guid('invalid'),
    })
    .nullish()
    .transform((value) => value ?? null),
})
export type SaveDraftRequest = z.input<typeof saveDraftSchema>

export const saveBroadcastTemplateSchema = z.object({
  name: z
    .string('required')
    .trim()
    .min(1, 'required')
    .max(BROADCAST_LIMITS.templateName, 'too_long'),
  subject: optionalSubject,
  body: bodySchema,
  channels: channelsSchema,
})
export type SaveBroadcastTemplateRequest = z.input<
  typeof saveBroadcastTemplateSchema
>

export const broadcastIdSchema = z.object({ id: z.guid('not_found') })

export const prefillSchema = z.object({
  source: z.enum(BROADCAST_SOURCES, 'invalid'),
  id: z.guid('not_found'),
})
export type PrefillRequest = z.input<typeof prefillSchema>

export type BroadcastRecipient = { gameNickname: string; isLeader: boolean }

export type PrefillResponse = {
  subject: string
  body: string
  /** Только для группы: состав в порядке группы, без адресов (BRC-04). */
  recipients: BroadcastRecipient[] | null
}

export type BroadcastAuthor = { gameNickname: string } | null

export type BroadcastDraft = {
  id: string
  subject: string | null
  body: string
  channels: BroadcastChannel[]
  attachments: BroadcastAttachment[]
  author: BroadcastAuthor
  createdAt: string
  /** Может ли текущий пользователь удалить черновик (автор или админ). */
  canDelete: boolean
}

export type BroadcastDraftsResponse = { items: BroadcastDraft[] }

export type BroadcastTemplate = {
  id: string
  name: string
  subject: string | null
  body: string
  channels: BroadcastChannel[]
  author: BroadcastAuthor
  canDelete: boolean
}

export type BroadcastTemplatesResponse = { items: BroadcastTemplate[] }
