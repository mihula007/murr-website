import { z } from 'zod'
import { AVATAR_TYPES } from './account.ts'
import {
  listMaterialsSchema,
  saveMaterialShape,
  type MaterialDetails,
  type MaterialListResponse,
} from './materials.ts'

/** Категории публикаций (PUB-02). */
export const PUBLICATION_CATEGORIES = [
  'article',
  'announcement',
  'news',
  'guide',
  'rules',
] as const
export type PublicationCategory = (typeof PUBLICATION_CATEGORIES)[number]

export const PUBLICATION_CATEGORY_LABELS: Record<PublicationCategory, string> =
  {
    article: 'Статья',
    announcement: 'Объявление',
    news: 'Новость',
    guide: 'Гайд',
    rules: 'Правила',
  }

/** Вложения публикаций (PUB-13, Q-11). */
export const PUBLICATION_FILE_LIMITS = {
  attachments: 10,
  bytes: 1024 * 1024,
  fileName: 200,
} as const

export const PUBLICATION_FILE_TYPES = AVATAR_TYPES
export type PublicationFileType = (typeof PUBLICATION_FILE_TYPES)[number]

export const listPublicationsSchema = listMaterialsSchema(
  PUBLICATION_CATEGORIES,
)

const attachmentInput = z.object({
  path: z.string().min(1).max(300),
  fileName: z
    .string()
    .trim()
    .min(1, 'required')
    .max(PUBLICATION_FILE_LIMITS.fileName, 'too_long'),
})

export const savePublicationSchema = z.object({
  ...saveMaterialShape(PUBLICATION_CATEGORIES),
  showAuthor: z.boolean(),
  attachments: z
    .array(attachmentInput)
    .max(PUBLICATION_FILE_LIMITS.attachments, 'too_many')
    .refine(
      (items) => new Set(items.map((item) => item.path)).size === items.length,
      'duplicate',
    ),
})
export type SavePublicationInput = z.input<typeof savePublicationSchema>

export const publicationUploadSchema = z.object({
  contentType: z.enum(PUBLICATION_FILE_TYPES),
})

export type PublicationUploadResponse = {
  bucket: string
  path: string
  token: string
}

export const discardUploadsSchema = z.object({
  paths: z
    .array(z.string().min(1).max(300))
    .max(PUBLICATION_FILE_LIMITS.attachments * 2),
})

export type PublicationAttachment = {
  path: string
  fileName: string
  /** Подписанная ссылка; null — файл недоступен (PUB-14). */
  url: string | null
}

export type PublicationDetails = MaterialDetails<PublicationCategory> & {
  showAuthor: boolean
  attachments: PublicationAttachment[]
}

export type PublicationListResponse = MaterialListResponse<PublicationCategory>
