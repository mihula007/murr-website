import { z } from 'zod'
import type { AccessRole } from './account.ts'
import { MEMBER_LIST_LIMIT, pageRequestShape, type Page } from './paging.ts'

/**
 * Рассылки (BRC): черновики, шаблоны и отправка анонса в Telegram и MAX
 * (TGM, MAX, VK). Вложений нет (Q-82).
 */
export const BROADCAST_CHANNELS = ['telegram', 'vk', 'max'] as const
export type BroadcastChannel = (typeof BROADCAST_CHANNELS)[number]

/** Каналы, в которые анонс действительно отправляется (MAX-05, VK-05, Q-99, Q-102). */
export const SENDABLE_CHANNELS = ['telegram', 'vk', 'max'] as const
export type SendableChannel = (typeof SENDABLE_CHANNELS)[number]

export const BROADCAST_CHANNEL_LABELS: Record<BroadcastChannel, string> = {
  telegram: 'Telegram',
  vk: 'ВКонтакте',
  max: 'MAX',
}

export const BROADCAST_LIMITS = {
  subject: 120,
  /** Лимит сообщения Telegram 4096 минус тема и строка ответа (Q-91). */
  body: 3800,
  /**
   * Анонс постоянного события с картинкой: подпись Telegram — 1024 символа,
   * минус тема и строка ответа (TGM-28, Q-114).
   */
  imageBody: 880,
  templateName: 60,
  /** Черновики — малый список (Q-69): хранится не больше 50 последних. */
  drafts: 50,
  /** Шаблоны — общие, не больше 20 (BRC-10, Q-70). */
  templates: 20,
} as const

export const BROADCAST_SOURCES = ['event', 'vote', 'group'] as const
export type BroadcastSource = (typeof BROADCAST_SOURCES)[number]

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

export const saveDraftSchema = z.object({
  subject: optionalSubject,
  body: bodySchema,
  channels: channelsSchema,
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

/**
 * Анонс в выбранные каналы (TGM-11–TGM-13, MAX-05); `eventId` — анонс
 * события с кнопками. Без `channels` — только Telegram (прежний клиент).
 */
const optionalId = z
  .guid('not_found')
  .nullish()
  .transform((value) => value ?? null)

export const sendAnnouncementSchema = z.object({
  subject: optionalSubject,
  body: bodySchema,
  eventId: optionalId,
  /** Анонс группы: только её участникам, без кнопок (TGM-12, Q-104). */
  groupId: optionalId,
  channels: z
    .array(z.enum(SENDABLE_CHANNELS, 'invalid'), 'required')
    .min(1, 'required')
    .nullish()
    .transform((items): SendableChannel[] =>
      items ? SENDABLE_CHANNELS.filter((c) => items.includes(c)) : ['telegram'],
    ),
  excludedUserIds: z
    .array(z.guid('invalid'), 'invalid')
    .max(MEMBER_LIST_LIMIT, 'too_many')
    .nullish()
    .transform((items) => Array.from(new Set(items ?? []))),
})
export type SendAnnouncementRequest = z.input<typeof sendAnnouncementSchema>

/**
 * Получатели для подтверждения; `groupId` — только участники группы,
 * `eventId` — анонс события: без ответивших на него (Q-109).
 */
export const recipientsSchema = z.object({
  ...pageRequestShape,
  groupId: optionalId,
  eventId: optionalId,
  classId: z
    .number()
    .int()
    .positive()
    .nullish()
    .transform((value) => value ?? null),
  channels: z
    .array(z.enum(SENDABLE_CHANNELS, 'invalid'), 'invalid')
    .min(1, 'required')
    .max(SENDABLE_CHANNELS.length, 'invalid')
    .nullish()
    .transform((items): SendableChannel[] =>
      items
        ? SENDABLE_CHANNELS.filter((channel) => items.includes(channel))
        : [...SENDABLE_CHANNELS],
    ),
  search: z
    .string()
    .trim()
    .max(100, 'too_long')
    .nullish()
    .transform((value) => value || null),
  excludedUserIds: z
    .array(z.guid('invalid'), 'invalid')
    .max(MEMBER_LIST_LIMIT, 'too_many')
    .nullish()
    .transform((items) => Array.from(new Set(items ?? []))),
})
export type RecipientsRequest = z.input<typeof recipientsSchema>

export type ChannelDelivery = {
  recipients: number
  sent: number
  failed: number
}

/**
 * Итог отправки: toast показывает отправленные и недоставленные (Q-84);
 * общие числа — сумма по каналам, `channels` — по каждому (MAX-10).
 */
export type SendAnnouncementResponse = ChannelDelivery & {
  channels?: Partial<Record<SendableChannel, ChannelDelivery>>
}

export type ChannelRecipients = {
  /** false — бот канала не настроен на сервере. */
  configured: boolean
  count: number
  /** Анонс события: привязаны, но уже ответили — не получат (Q-109). */
  answered?: number
}

/** Получатели для окна подтверждения (TGM-11, MAX-05). */
export type BroadcastRecipientsResponse = {
  /** Получатели Telegram — для прежнего клиента. */
  count: number
  channels?: Record<SendableChannel, ChannelRecipients>
} & Page<BroadcastRecipientOption>

export type BroadcastRecipientOption = {
  id: string
  gameNickname: string
  /** Активные каналы, в которые этот профиль может получить объявление. */
  channels: SendableChannel[]
}

export const broadcastIdSchema = z.object({ id: z.guid('not_found') })

export const prefillSchema = z.object({
  source: z.enum(BROADCAST_SOURCES, 'invalid'),
  id: z.guid('not_found'),
})
export type PrefillRequest = z.input<typeof prefillSchema>

/** Поиск и курсор для вкладки «Подписки» (BRC-15, Q-112). */
export const broadcastSubscriptionsSchema = z.object({
  ...pageRequestShape,
  unlinkedOnly: z.boolean().default(false),
  search: z
    .string()
    .trim()
    .max(100, 'too_long')
    .nullish()
    .transform((value) => value || null),
})
export type BroadcastSubscriptionsRequest = z.input<
  typeof broadcastSubscriptionsSchema
>

export type MessengerLinkStatus = { linked: boolean; blocked: boolean }
export type BroadcastSubscription = {
  id: string
  gameNickname: string
  role: AccessRole
  telegram: MessengerLinkStatus
  vk: MessengerLinkStatus
  max: MessengerLinkStatus
}
export type BroadcastSubscriptionsResponse = Page<BroadcastSubscription>

export type BroadcastRecipient = { gameNickname: string; isLeader: boolean }

export type PrefillResponse = {
  subject: string
  body: string
  /** Только для группы: состав в порядке группы, без адресов (BRC-04). */
  recipients: BroadcastRecipient[] | null
  /**
   * Постоянное событие: анонс с картинкой, текст не длиннее этого числа
   * (TGM-28, Q-114); нет поля — обычный лимит.
   */
  bodyLimit?: number
}

export type BroadcastAuthor = { gameNickname: string } | null

export type BroadcastDraft = {
  id: string
  subject: string | null
  body: string
  channels: BroadcastChannel[]
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
