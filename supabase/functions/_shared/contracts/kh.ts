import { z } from 'zod'
import type { Page } from './paging.ts'

export const KH_QUEUE_IDS = [
  'summons',
  'kh_hands',
  'scale_buyout',
  'highest_buyout',
  'highest',
  'meteorites',
  'uf_passes',
  'essence',
  'scale',
  'dobi_stones',
  's_cards',
  'kh_passes',
  'disc',
  'pet',
] as const

export type KhQueueId = (typeof KH_QUEUE_IDS)[number]

export const KH_QUEUE_LABELS: Record<KhQueueId, string> = {
  summons: 'призывы',
  kh_hands: 'руки кх:',
  scale_buyout: 'чешуя выкуп:',
  highest_buyout: 'высший выкуп',
  highest: 'высший',
  meteorites: 'метеориты',
  uf_passes: 'проходки уф',
  essence: 'сущность',
  scale: 'чешуя',
  dobi_stones: 'камни доблы',
  s_cards: 'карты s',
  kh_passes: 'проходки кх',
  disc: 'диск',
  pet: 'пет',
}

export const khQueueKeySchema = z.enum(KH_QUEUE_IDS)

const cursorSchema = z.string().min(1).max(512).optional()
const cursorShape = Object.fromEntries(
  KH_QUEUE_IDS.map((queueId) => [queueId, cursorSchema]),
) as Record<KhQueueId, typeof cursorSchema>

export const khQueuesRequestSchema = z.object({
  cursors: z.object(cursorShape).strict().optional(),
})

export const khQueueEntryIdSchema = z
  .string()
  .regex(/^[1-9]\d{0,18}$/)
  .refine((value) => BigInt(value) <= 9_223_372_036_854_775_807n)

export const khQueueEntrySchema = z.object({
  id: khQueueEntryIdSchema,
  userId: z.string().uuid().nullable(),
  gameNickname: z.string().min(1).max(40),
  autoRejoin: z.boolean(),
})

export const khQueuePageSchema = z.object({
  items: z.array(khQueueEntrySchema),
  nextCursor: z.string().min(1).max(512).nullable(),
})

const queuePagesShape = Object.fromEntries(
  KH_QUEUE_IDS.map((queueId) => [queueId, khQueuePageSchema]),
) as Record<KhQueueId, typeof khQueuePageSchema>

export const khQueuesResponseSchema = z.object({
  queues: z.object(queuePagesShape).strict(),
})

export const khQueueActionSchema = z.object({
  queueKey: khQueueKeySchema,
})

export const khQueueEntryActionSchema = khQueueActionSchema.extend({
  entryId: khQueueEntryIdSchema,
})

export const khQueueLimitSchema = z.object({
  maxActiveQueues: z.number().int().min(1).max(14),
})

export const khQueueSettingsResponseSchema = z.object({
  maxActiveQueues: z.number().int().min(1).max(14),
  activeQueueCount: z.number().int().min(0).max(14),
})

export const khQueueRepeatSchema = khQueueEntryActionSchema.extend({
  autoRejoin: z.boolean(),
})

export const KH_REWARD_HISTORY_PAGE_SIZE = 20

const nullableDate = z.iso
  .date()
  .nullish()
  .transform((value) => value ?? null)

export const khRewardHistoryRequestSchema = z
  .object({
    dateFrom: nullableDate,
    dateTo: nullableDate,
    cursor: z
      .string()
      .max(512, 'invalid')
      .nullish()
      .transform((value) => value || null),
  })
  .superRefine((value, ctx) => {
    if (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo) {
      ctx.addIssue({
        code: 'custom',
        path: ['dateTo'],
        message: 'invalid',
      })
    }
  })

export const khRewardHistoryRowSchema = z.object({
  id: khQueueEntryIdSchema,
  queueKey: khQueueKeySchema,
  rewardName: z.string().min(1).max(80),
  userId: z.string().uuid().nullable(),
  gameNickname: z.string().min(1).max(40),
  issuedAt: z.iso.datetime({ offset: true }),
})

export const khRewardHistoryResponseSchema = z.object({
  items: z.array(khRewardHistoryRowSchema),
  nextCursor: z.string().min(1).max(512).nullable(),
})

export type KhQueuesRequest = z.input<typeof khQueuesRequestSchema>
export type KhQueueEntry = z.infer<typeof khQueueEntrySchema>
export type KhQueuePage = z.infer<typeof khQueuePageSchema>
export type KhQueuesResponse = z.infer<typeof khQueuesResponseSchema>
export type KhQueueAction = z.infer<typeof khQueueActionSchema>
export type KhQueueEntryAction = z.infer<typeof khQueueEntryActionSchema>
export type KhQueueLimit = z.infer<typeof khQueueLimitSchema>
export type KhQueueSettingsResponse = z.infer<
  typeof khQueueSettingsResponseSchema
>
export type KhQueueRepeat = z.infer<typeof khQueueRepeatSchema>
export type KhRewardHistoryRequest = z.input<
  typeof khRewardHistoryRequestSchema
>
export type KhRewardHistoryResponse = z.infer<
  typeof khRewardHistoryResponseSchema
>
export type KhRewardHistoryRow = z.infer<typeof khRewardHistoryRowSchema>
export type KhRewardHistoryPage = Page<KhRewardHistoryRow>
