import { z } from 'zod'

/**
 * Подмножество события Callback API, которое разбирает вебхук. Общие поля —
 * `type`, `group_id`, `secret`; остальные отбрасываются, событие другого
 * вида игнорируется.
 */
const base = {
  group_id: z.number().int(),
  secret: z.string().optional(),
  event_id: z.string().optional(),
}

const confirmationSchema = z.object({
  ...base,
  type: z.literal('confirmation'),
})

const messageNewSchema = z.object({
  ...base,
  type: z.literal('message_new'),
  object: z.object({
    message: z.object({
      from_id: z.number().int(),
      peer_id: z.number().int(),
      text: z.string().optional(),
      ref: z.string().optional(),
    }),
  }),
})

const messageEventSchema = z.object({
  ...base,
  type: z.literal('message_event'),
  object: z.object({
    user_id: z.number().int(),
    peer_id: z.number().int(),
    event_id: z.string().min(1),
    // Схема API называет `payload` строкой, клиенты присылают объект.
    payload: z.unknown(),
    conversation_message_id: z.number().int().optional(),
  }),
})

const messageAllowSchema = z.object({
  ...base,
  type: z.literal('message_allow'),
  object: z.object({ user_id: z.number().int() }),
})

const messageDenySchema = z.object({
  ...base,
  type: z.literal('message_deny'),
  object: z.object({ user_id: z.number().int() }),
})

export const eventSchema = z.discriminatedUnion('type', [
  confirmationSchema,
  messageNewSchema,
  messageEventSchema,
  messageAllowSchema,
  messageDenySchema,
])

/** Первичная проверка: группа и секрет до разбора вида события. */
export const envelopeSchema = z.object({
  type: z.string(),
  group_id: z.number().int(),
  secret: z.string().optional(),
})

export type VkEvent = z.output<typeof eventSchema>
export type VkMessageEvent = Extract<VkEvent, { type: 'message_event' }>

/** Данные кнопки из `payload`: строка JSON или объект `{ d }` (VK-07). */
export function payloadData(payload: unknown): string {
  let value = payload
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return ''
    }
  }
  const data = (value as { d?: unknown } | null)?.d
  return typeof data === 'string' ? data : ''
}
