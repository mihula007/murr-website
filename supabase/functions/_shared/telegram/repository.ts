import { sql } from 'kysely'
import type { EventAnswer } from '../contracts/events.ts'
import type { Executor } from '../db/client.ts'
import { INTERNAL_ROLES } from '../membership.ts'

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

  /**
   * Получатели анонса (TGM-14, Q-83): член, офицер, администратор с активной
   * связью, кроме удаляемых аккаунтов; для анонса события — с текущим ответом.
   */
  async recipients(db: Executor, eventId: string | null) {
    const rows = await recipientsQuery(db)
      .leftJoin('app.event_attendance as a', (join) =>
        join
          .onRef('a.user_id', '=', 'l.user_id')
          .on('a.event_id', '=', eventId ?? NO_EVENT),
      )
      .select(['l.user_id', 'l.chat_id', 'a.answer'])
      .orderBy('l.user_id')
      .execute()
    return rows.map((row) => ({
      userId: row.user_id,
      chatId: Number(row.chat_id),
      answer: (row.answer as EventAnswer | null) ?? null,
    }))
  },

  async recipientCount(db: Executor) {
    const row = await recipientsQuery(db)
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .executeTakeFirstOrThrow()
    return Number(row.count)
  },

  async createAnnouncement(
    tx: Executor,
    values: { eventId: string; subject: string | null; body: string },
  ) {
    const row = await tx
      .insertInto('app.telegram_announcements')
      .values({
        event_id: values.eventId,
        subject: values.subject,
        body: values.body,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
    return row.id
  },

  /** Активное сообщение участника по событию с текстом его анонса. */
  async activeMessage(db: Executor, eventId: string, userId: string) {
    const row = await activeMessageQuery(db)
      .where('m.event_id', '=', eventId)
      .where('m.user_id', '=', userId)
      .executeTakeFirst()
    return row ? toActiveMessage(row) : null
  },

  /**
   * Новое активное сообщение вместо прежнего (TGM-22, Q-78). Возвращает
   * прежнее, чтобы снять с него кнопки; анонс без сообщений удаляется.
   */
  async replaceActiveMessage(
    tx: Executor,
    values: {
      eventId: string
      userId: string
      announcementId: string
      chatId: number
      messageId: number
    },
  ) {
    const previousRow = await activeMessageQuery(tx)
      .where('m.event_id', '=', values.eventId)
      .where('m.user_id', '=', values.userId)
      .forUpdate()
      .executeTakeFirst()
    const row = {
      announcement_id: values.announcementId,
      chat_id: values.chatId,
      message_id: values.messageId,
      sent_at: sql<string>`now()`,
    }
    await tx
      .insertInto('app.telegram_event_messages')
      .values({ event_id: values.eventId, user_id: values.userId, ...row })
      .onConflict((oc) => oc.columns(['event_id', 'user_id']).doUpdateSet(row))
      .execute()
    if (!previousRow) {
      return null
    }
    if (previousRow.announcement_id !== values.announcementId) {
      await tx
        .deleteFrom('app.telegram_announcements')
        .where('id', '=', previousRow.announcement_id)
        .where((eb) =>
          eb.not(
            eb.exists(
              eb
                .selectFrom('app.telegram_event_messages')
                .select('event_id')
                .whereRef(
                  'announcement_id',
                  '=',
                  'app.telegram_announcements.id',
                ),
            ),
          ),
        )
        .execute()
    }
    return toActiveMessage(previousRow)
  },
}

/** Заглушка для левого соединения отдельного анонса: ответов нет. */
const NO_EVENT = '00000000-0000-0000-0000-000000000000'

function recipientsQuery(db: Executor) {
  return db
    .selectFrom('app.telegram_links as l')
    .innerJoin('app.profiles as p', 'p.id', 'l.user_id')
    .where('p.access_role', 'in', INTERNAL_ROLES)
    .where('l.blocked_at', 'is', null)
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('app.user_deletions as d')
            .select('d.user_id')
            .whereRef('d.user_id', '=', 'l.user_id'),
        ),
      ),
    )
}

function activeMessageQuery(db: Executor) {
  return db
    .selectFrom('app.telegram_event_messages as m')
    .innerJoin('app.telegram_announcements as t', 't.id', 'm.announcement_id')
    .select([
      'm.announcement_id',
      'm.chat_id',
      'm.message_id',
      't.subject',
      't.body',
    ])
}

export type ActiveMessage = {
  announcementId: string
  chatId: number
  messageId: number
  subject: string | null
  body: string
}

const toActiveMessage = (row: {
  announcement_id: string
  chat_id: number
  message_id: number
  subject: string | null
  body: string
}): ActiveMessage => ({
  announcementId: row.announcement_id,
  chatId: Number(row.chat_id),
  messageId: Number(row.message_id),
  subject: row.subject,
  body: row.body,
})
