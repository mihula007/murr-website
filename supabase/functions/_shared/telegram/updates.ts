import { z } from 'zod'

/**
 * Подмножество апдейта Bot API, которое разбирает вебхук. Остальные поля
 * отбрасываются; апдейт другого вида игнорируется.
 */
const userSchema = z.object({
  id: z.number().int(),
  is_bot: z.boolean().optional(),
  first_name: z.string(),
  last_name: z.string().optional(),
  username: z.string().optional(),
})

const chatSchema = z.object({
  id: z.number().int(),
  type: z.string(),
})

const messageSchema = z.object({
  message_id: z.number().int(),
  from: userSchema.optional(),
  chat: chatSchema,
  text: z.string().optional(),
})

const callbackQuerySchema = z.object({
  id: z.string(),
  from: userSchema,
  data: z.string().optional(),
  message: z
    .object({ message_id: z.number().int(), chat: chatSchema })
    .optional(),
})

export const updateSchema = z.object({
  update_id: z.number().int(),
  message: messageSchema.optional(),
  callback_query: callbackQuerySchema.optional(),
})

export type TelegramUser = z.output<typeof userSchema>
export type TelegramMessage = z.output<typeof messageSchema>
export type TelegramCallbackQuery = z.output<typeof callbackQuerySchema>

/** Имя для показа: имя и фамилия Telegram (TGM-06). */
export function displayNameOf(user: TelegramUser) {
  const name = [user.first_name, user.last_name]
    .filter(Boolean)
    .join(' ')
    .trim()
  return (name || String(user.id)).slice(0, 200)
}

/** Аргумент `/start <код>`; `null` — команда без кода; `undefined` — не `/start`. */
export function startArgument(text: string | undefined) {
  const match = /^\/start(?:@\w+)?(?:\s+(\S+))?\s*$/.exec(text ?? '')
  if (!match) {
    return undefined
  }
  return match[1] ?? null
}
