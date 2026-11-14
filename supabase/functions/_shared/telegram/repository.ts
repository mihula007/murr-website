import type { Executor } from '../db/client.ts'

export type LinkValues = {
  userId: string
  telegramUserId: number
  chatId: number
  username: string | null
  displayName: string
}

export type TelegramLink = LinkValues & {
  linkedAt: string
  blockedAt: string | null
}

const LINK_COLUMNS = [
  'user_id',
  'telegram_user_id',
  'chat_id',
  'username',
  'display_name',
  'linked_at',
  'blocked_at',
] as const

type LinkRow = {
  user_id: string
  telegram_user_id: number
  chat_id: number
  username: string | null
  display_name: string
  linked_at: string
  blocked_at: string | null
}

// postgres.js отдаёт bigint строкой; ID Telegram меньше 2^53 — безопасно в number.
const toLink = (row: LinkRow): TelegramLink => ({
  userId: row.user_id,
  telegramUserId: Number(row.telegram_user_id),
  chatId: Number(row.chat_id),
  username: row.username,
  displayName: row.display_name,
  linkedAt: row.linked_at,
  blockedAt: row.blocked_at,
})

/** Ограничение «один Telegram — один аккаунт» (TGM-04, Q-89). */
export const TELEGRAM_USER_CONSTRAINT = 'telegram_links_telegram_user_id_key'

export const telegramRepository = {
  async linkByUser(db: Executor, userId: string) {
    const row = await db
      .selectFrom('app.telegram_links')
      .select(LINK_COLUMNS)
      .where('user_id', '=', userId)
      .executeTakeFirst()
    return row ? toLink(row) : null
  },

  async linkByTelegram(db: Executor, telegramUserId: number) {
    const row = await db
      .selectFrom('app.telegram_links')
      .select(LINK_COLUMNS)
      .where('telegram_user_id', '=', telegramUserId)
      .executeTakeFirst()
    return row ? toLink(row) : null
  },

  /** Новый код заменяет прежний код пользователя. */
  async saveCode(
    db: Executor,
    values: { userId: string; codeHash: string; expiresAt: string },
  ) {
    await db
      .insertInto('app.telegram_link_codes')
      .values({
        user_id: values.userId,
        code_hash: values.codeHash,
        expires_at: values.expiresAt,
      })
      .onConflict((oc) =>
        oc.column('user_id').doUpdateSet({
          code_hash: values.codeHash,
          expires_at: values.expiresAt,
        }),
      )
      .execute()
  },

  /**
   * Забирает код одним `DELETE … RETURNING`: при двух одновременных
   * `/start` код достаётся только одному (TGM-03).
   */
  takeCode(tx: Executor, codeHash: string) {
    return tx
      .deleteFrom('app.telegram_link_codes')
      .where('code_hash', '=', codeHash)
      .returning(['user_id', 'expires_at'])
      .executeTakeFirst()
  },

  async deleteCode(db: Executor, userId: string) {
    await db
      .deleteFrom('app.telegram_link_codes')
      .where('user_id', '=', userId)
      .execute()
  },

  /** Привязка или перепривязка своего аккаунта к другому Telegram (TGM-04). */
  async saveLink(tx: Executor, values: LinkValues, at: string) {
    const row = {
      telegram_user_id: values.telegramUserId,
      chat_id: values.chatId,
      username: values.username,
      display_name: values.displayName,
      linked_at: at,
      blocked_at: null,
    }
    await tx
      .insertInto('app.telegram_links')
      .values({ user_id: values.userId, ...row })
      .onConflict((oc) => oc.column('user_id').doUpdateSet(row))
      .execute()
  },

  async deleteLink(db: Executor, userId: string) {
    await db
      .deleteFrom('app.telegram_links')
      .where('user_id', '=', userId)
      .execute()
  },

  /** Обращение привязанного пользователя: имя для показа, снятие блокировки бота. */
  async touchLink(
    db: Executor,
    telegramUserId: number,
    values: { chatId: number; username: string | null; displayName: string },
  ) {
    await db
      .updateTable('app.telegram_links')
      .set({
        chat_id: values.chatId,
        username: values.username,
        display_name: values.displayName,
        blocked_at: null,
      })
      .where('telegram_user_id', '=', telegramUserId)
      .execute()
  },

  async markBlocked(db: Executor, userId: string, at: string) {
    await db
      .updateTable('app.telegram_links')
      .set({ blocked_at: at })
      .where('user_id', '=', userId)
      .where('blocked_at', 'is', null)
      .execute()
  },
}
