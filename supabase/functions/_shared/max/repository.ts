import { sql } from 'kysely'
import type { Executor } from '../db/client.ts'
import { INTERNAL_ROLES } from '../membership.ts'

export type LinkValues = {
  userId: string
  maxUserId: number
  chatId: number
  username: string | null
  displayName: string
}

export type MaxLink = LinkValues & {
  linkedAt: string
  blockedAt: string | null
}

const LINK_COLUMNS = [
  'user_id',
  'max_user_id',
  'chat_id',
  'username',
  'display_name',
  'linked_at',
  'blocked_at',
] as const

type LinkRow = {
  user_id: string
  max_user_id: number
  chat_id: number
  username: string | null
  display_name: string
  linked_at: string
  blocked_at: string | null
}

// postgres.js отдаёт bigint строкой; ID MAX меньше 2^53 — безопасно в number.
const toLink = (row: LinkRow): MaxLink => ({
  userId: row.user_id,
  maxUserId: Number(row.max_user_id),
  chatId: Number(row.chat_id),
  username: row.username,
  displayName: row.display_name,
  linkedAt: row.linked_at,
  blockedAt: row.blocked_at,
})

/** Ограничение «один MAX — один аккаунт» (MAX-01). */
export const MAX_USER_CONSTRAINT = 'max_links_max_user_id_key'

export const maxRepository = {
  async linkByUser(db: Executor, userId: string) {
    const row = await db
      .selectFrom('app.max_links')
      .select(LINK_COLUMNS)
      .where('user_id', '=', userId)
      .executeTakeFirst()
    return row ? toLink(row) : null
  },

  async linkByMax(db: Executor, maxUserId: number) {
    const row = await db
      .selectFrom('app.max_links')
      .select(LINK_COLUMNS)
      .where('max_user_id', '=', maxUserId)
      .executeTakeFirst()
    return row ? toLink(row) : null
  },

  /** Новый код заменяет прежний код пользователя. */
  async saveCode(
    db: Executor,
    values: { userId: string; codeHash: string; expiresAt: string },
  ) {
    await db
      .insertInto('app.max_link_codes')
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
      .deleteFrom('app.max_link_codes')
      .where('code_hash', '=', codeHash)
      .returning(['user_id', 'expires_at'])
      .executeTakeFirst()
  },

  async deleteCode(db: Executor, userId: string) {
    await db
      .deleteFrom('app.max_link_codes')
      .where('user_id', '=', userId)
      .execute()
  },

  /** Привязка или перепривязка своего аккаунта к другому MAX (MAX-01). */
  async saveLink(tx: Executor, values: LinkValues, at: string) {
    const row = {
      max_user_id: values.maxUserId,
      chat_id: values.chatId,
      username: values.username,
      display_name: values.displayName,
      linked_at: at,
      blocked_at: null,
    }
    await tx
      .insertInto('app.max_links')
      .values({ user_id: values.userId, ...row })
      .onConflict((oc) => oc.column('user_id').doUpdateSet(row))
      .execute()
  },

  async deleteLink(db: Executor, userId: string) {
    await db.deleteFrom('app.max_links').where('user_id', '=', userId).execute()
  },

  /** Обращение привязанного пользователя: имя для показа, снятие блокировки бота. */
  async touchLink(
    db: Executor,
    maxUserId: number,
    values: { chatId: number; username: string | null; displayName: string },
  ) {
    await db
      .updateTable('app.max_links')
      .set({
        chat_id: values.chatId,
        username: values.username,
        display_name: values.displayName,
        blocked_at: null,
      })
      .where('max_user_id', '=', maxUserId)
      .execute()
  },

  /** Пользователь остановил бота (`bot_stopped`, MAX-03). */
  async markBlockedByMax(db: Executor, maxUserId: number, at: string) {
    await db
      .updateTable('app.max_links')
      .set({ blocked_at: at })
      .where('max_user_id', '=', maxUserId)
      .where('blocked_at', 'is', null)
      .execute()
  },

  async markBlocked(db: Executor, userId: string, at: string) {
    await db
      .updateTable('app.max_links')
      .set({ blocked_at: at })
      .where('user_id', '=', userId)
      .where('blocked_at', 'is', null)
      .execute()
  },

  /**
   * Получатели анонса в MAX (MAX-06, как TGM-14): член, офицер, администратор с активной
   * связью, кроме удаляемых аккаунтов; для анонса события — без ответивших на него (Q-109).
   */
  async recipients(
    db: Executor,
    eventId: string | null,
    groupId: string | null = null,
  ) {
    const rows = await recipientsQuery(db, groupId, eventId)
      .select(['l.user_id', 'l.max_user_id', 'l.chat_id'])
      .orderBy('l.user_id')
      .execute()
    return rows.map((row) => ({
      userId: row.user_id,
      // Сообщения в MAX отправляются по ID пользователя (`user_id`).
      maxUserId: Number(row.max_user_id),
      chatId: Number(row.chat_id),
    }))
  },

  /**
   * `groupId` — только участники группы события (Q-104); `eventId` — без
   * ответивших на событие (Q-109).
   */
  async recipientCount(
    db: Executor,
    groupId: string | null = null,
    eventId: string | null = null,
    excludedUserIds: string[] = [],
  ) {
    let query = recipientsQuery(db, groupId, eventId)
    if (excludedUserIds.length > 0) {
      query = query.where('l.user_id', 'not in', excludedUserIds)
    }
    const row = await query
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .executeTakeFirstOrThrow()
    return Number(row.count)
  },

  async createAnnouncement(
    tx: Executor,
    values: { eventId: string; subject: string | null; body: string },
  ) {
    const row = await tx
      .insertInto('app.max_announcements')
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
      messageId: string
      /** Картинка сообщения (TGM-27); null — без картинки. */
      media: string | null
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
      media: values.media,
      sent_at: sql<string>`now()`,
    }
    await tx
      .insertInto('app.max_event_messages')
      .values({ event_id: values.eventId, user_id: values.userId, ...row })
      .onConflict((oc) => oc.columns(['event_id', 'user_id']).doUpdateSet(row))
      .execute()
    if (!previousRow) {
      return null
    }
    if (previousRow.announcement_id !== values.announcementId) {
      await tx
        .deleteFrom('app.max_announcements')
        .where('id', '=', previousRow.announcement_id)
        .where((eb) =>
          eb.not(
            eb.exists(
              eb
                .selectFrom('app.max_event_messages')
                .select('event_id')
                .whereRef('announcement_id', '=', 'app.max_announcements.id'),
            ),
          ),
        )
        .execute()
    }
    return toActiveMessage(previousRow)
  },
}

/** Получатели; с `groupId` — только участники этой группы (Q-104). */
function recipientsQuery(
  db: Executor,
  groupId: string | null,
  eventId: string | null = null,
) {
  const base = db
    .selectFrom('app.max_links as l')
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
  // Анонс события не получают уже ответившие на него (Q-109).
  const query =
    eventId === null
      ? base
      : base.where((eb) =>
          eb.not(
            eb.exists(
              eb
                .selectFrom('app.event_attendance as a')
                .select('a.user_id')
                .whereRef('a.user_id', '=', 'l.user_id')
                .where('a.event_id', '=', eventId),
            ),
          ),
        )
  return groupId === null
    ? query
    : query.where('l.user_id', 'in', (eb) =>
        eb
          .selectFrom('app.event_group_members as g')
          .select('g.user_id')
          .where('g.group_id', '=', groupId),
      )
}

function activeMessageQuery(db: Executor) {
  return db
    .selectFrom('app.max_event_messages as m')
    .innerJoin('app.max_announcements as t', 't.id', 'm.announcement_id')
    .select([
      'm.announcement_id',
      'm.chat_id',
      'm.message_id',
      'm.media',
      't.subject',
      't.body',
    ])
}

export type MaxActiveMessage = {
  announcementId: string
  chatId: number
  messageId: string
  subject: string | null
  body: string
  /** Картинка сообщения (TGM-27); null — без картинки. */
  media: string | null
}

const toActiveMessage = (row: {
  announcement_id: string
  chat_id: number
  message_id: string
  subject: string | null
  body: string
  media: string | null
}): MaxActiveMessage => ({
  announcementId: row.announcement_id,
  chatId: Number(row.chat_id),
  messageId: row.message_id,
  subject: row.subject,
  body: row.body,
  media: row.media,
})
