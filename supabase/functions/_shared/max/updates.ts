import { z } from 'zod'

/**
 * Подмножество апдейта MAX, которое разбирает вебхук. Остальные поля
 * отбрасываются; апдейт другого вида игнорируется.
 */
const userSchema = z.object({
  user_id: z.number().int(),
  first_name: z.string().nullish(),
  last_name: z.string().nullish(),
  name: z.string().nullish(),
  username: z.string().nullish(),
  is_bot: z.boolean().optional(),
})

const messageSchema = z.object({
  sender: userSchema.nullish(),
  recipient: z.object({
    chat_id: z.number().int().nullish(),
    chat_type: z.string(),
  }),
  body: z
    .object({ mid: z.string().min(1), text: z.string().nullish() })
    .nullish(),
})

const botStartedSchema = z.object({
  update_type: z.literal('bot_started'),
  chat_id: z.number().int(),
  user: userSchema,
  payload: z.string().nullish(),
})

const botStoppedSchema = z.object({
  update_type: z.literal('bot_stopped'),
  chat_id: z.number().int(),
  user: userSchema,
})

const messageCreatedSchema = z.object({
  update_type: z.literal('message_created'),
  message: messageSchema,
})

const messageCallbackSchema = z.object({
  update_type: z.literal('message_callback'),
  callback: z.object({
    callback_id: z.string().min(1),
    payload: z.string().nullish(),
    user: userSchema,
  }),
  message: messageSchema.nullish(),
})

export const updateSchema = z.discriminatedUnion('update_type', [
  botStartedSchema,
  botStoppedSchema,
  messageCreatedSchema,
  messageCallbackSchema,
])

export type MaxUser = z.output<typeof userSchema>
export type MaxUpdate = z.output<typeof updateSchema>
export type MaxMessage = z.output<typeof messageSchema>

/** Имя для показа: имя и фамилия MAX (как TGM-06). */
export function displayNameOf(user: MaxUser) {
  const name =
    [user.first_name, user.last_name].filter(Boolean).join(' ').trim() ||
    (user.name ?? '').trim()
  return (name || String(user.user_id)).slice(0, 200)
}

/** Username для показа: пустой и слишком длинный не сохраняются. */
export function usernameOf(user: MaxUser) {
  const value = user.username?.trim()
  return value && value.length <= 64 ? value : null
}
