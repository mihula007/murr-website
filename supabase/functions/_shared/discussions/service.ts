import { z } from 'zod'
import { avatarUrls } from '../account/avatars.ts'
import type { AppDeps } from '../app.ts'
import { requireRole, type Actor, type ProfiledActor } from '../auth/actor.ts'
import {
  DISCUSSION_LIMITS,
  discussionChangesSchema,
  editMessageSchema,
  listDiscussionSchema,
  markReadSchema,
  mentionCandidates,
  messageIdSchema,
  reactSchema,
  sendMessageSchema,
  type DiscussionChanges,
  type DiscussionMessage,
  type DiscussionPage,
  type DiscussionReactions,
  type DiscussionReaders,
  type Reaction,
  type ThreadRef,
} from '../contracts/discussions.ts'
import { parseTimestamp } from '../contracts/moscow-time.ts'
import { MEMBER_LIST_LIMIT } from '../contracts/paging.ts'
import { withTransaction, type Executor } from '../db/client.ts'
import { decodeCursor, splitPage } from '../http/cursor.ts'
import { ApiError } from '../http/errors.ts'
import { parseBody } from '../http/validation.ts'
import { INTERNAL_ROLES } from '../membership.ts'
import { notify } from '../notifications/service.ts'
import { discussionRepository as repo, type MessageRow } from './repository.ts'
import { parentAccess, parentOfThread, type ParentAccess } from './parents.ts'

/** Ветки читают и пишут члены, офицеры и администраторы (DSC, ACL). */
const PARTICIPANTS = INTERNAL_ROLES
/** Список прочитавших любого сообщения (Q-59); автор видит свой всегда. */
const READ_LIST_ROLES: readonly string[] = ['officer', 'admin']

const iso = (value: string) => parseTimestamp(value).toISOString()

/** Курсор страницы: `[created_at, id]` строкой БД. */
const messageCursor = z
  .tuple([z.string().min(1).max(64), z.guid()])
  .transform(([createdAt, id]) => ({ createdAt, id }))

function excerpt(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** Сообщения ответа: автор, значок роли, цитата, реакции зрителя. */
async function toMessages(
  deps: AppDeps,
  viewer: ProfiledActor,
  rows: MessageRow[],
): Promise<DiscussionMessage[]> {
  const [totals, urls] = await Promise.all([
    repo.reactionTotals(
      deps.db,
      rows.map((row) => row.id),
      viewer.userId,
    ),
    avatarUrls(
      deps.storage,
      rows.map((row) => row.author_avatar_path),
    ),
  ])
  return rows.map((row) => ({
    id: row.id,
    author:
      row.author_id && row.author_nickname
        ? {
            state: 'shown',
            id: row.author_id,
            gameNickname: row.author_nickname,
            avatarUrl: row.author_avatar_path
              ? (urls.get(row.author_avatar_path) ?? null)
              : null,
            badge:
              row.author_role === 'officer' || row.author_role === 'admin'
                ? row.author_role
                : null,
          }
        : { state: 'deleted' },
    mine: row.author_id === viewer.userId,
    body: row.body,
    createdAt: iso(row.created_at),
    editedAt: row.edited_at ? iso(row.edited_at) : null,
    changedAt: iso(row.changed_at),
    replyTo: row.reply_id
      ? {
          id: row.reply_id,
          gameNickname: row.reply_nickname ?? null,
          excerpt: excerpt(row.reply_body ?? '', DISCUSSION_LIMITS.quote),
        }
      : null,
    reactions: totals
      .filter((total) => total.message_id === row.id)
      .map((total) => ({
        emoji: total.emoji as Reaction,
        count: Number(total.count),
        mine: Number(total.mine) > 0,
      })),
  }))
}

async function othersReadUpTo(
  db: Executor,
  threadId: string | null,
  viewerId: string,
) {
  if (!threadId) {
    return null
  }
  const upTo = await repo.othersReadUpTo(db, threadId, viewerId)
  return upTo ? iso(upTo) : null
}

/** Страница ветки от новых к старым (Q-62); пустая ветка не создаётся. */
export async function listDiscussion(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<DiscussionPage> {
  const viewer = requireRole(actor, PARTICIPANTS)
  const input = parseBody(listDiscussionSchema, body)
  const access = await parentAccess(deps.db, viewer, input, false)
  const now = deps.now().toISOString()
  const threadId = await repo.findThread(deps.db, input.parent, input.parentId)
  if (!threadId) {
    return {
      items: [],
      nextCursor: null,
      canWrite: access.canWrite,
      othersReadUpTo: null,
      now,
    }
  }
  const after = input.cursor ? decodeCursor(messageCursor, input.cursor) : null
  const [rows, readUpTo] = await Promise.all([
    repo.page(deps.db, threadId, after, input.limit + 1),
    othersReadUpTo(deps.db, threadId, viewer.userId),
  ])
  const page = splitPage(rows, input.limit, (row) => [row.created_at, row.id])
  return {
    items: await toMessages(deps, viewer, page.rows),
    nextCursor: page.nextCursor,
    canWrite: access.canWrite,
    othersReadUpTo: readUpTo,
    now,
  }
}

/**
 * Изменения ветки после `since` для опроса открытого окна (Q-58): новые,
 * правленые сообщения и сообщения с изменёнными реакциями. Окно немного
 * перекрывается назад — запись, зафиксированная позже своего времени, не
 * теряется; клиент сливает повторы по `id`.
 */
export async function discussionChanges(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<DiscussionChanges> {
  const viewer = requireRole(actor, PARTICIPANTS)
  const input = parseBody(discussionChangesSchema, body)
  const access = await parentAccess(deps.db, viewer, input, false)
  const now = deps.now().toISOString()
  const threadId = await repo.findThread(deps.db, input.parent, input.parentId)
  if (!threadId) {
    return {
      items: [],
      reset: false,
      canWrite: access.canWrite,
      othersReadUpTo: null,
      now,
    }
  }
  const since = new Date(
    new Date(input.since).getTime() - DISCUSSION_LIMITS.changesOverlapMs,
  ).toISOString()
  const limit = DISCUSSION_LIMITS.changes
  const [rows, readUpTo] = await Promise.all([
    repo.changedSince(deps.db, threadId, since, limit + 1),
    othersReadUpTo(deps.db, threadId, viewer.userId),
  ])
  const reset = rows.length > limit
  return {
    items: reset ? [] : await toMessages(deps, viewer, rows),
    reset,
    canWrite: access.canWrite,
    othersReadUpTo: readUpTo,
    now,
  }
}

/** Родитель под блокировкой, открытый для записи; иначе state_conflict. */
async function writableParent(
  tx: Executor,
  viewer: ProfiledActor,
  ref: ThreadRef,
): Promise<ParentAccess> {
  const access = await parentAccess(tx, viewer, ref, true)
  if (!access.canWrite) {
    throw new ApiError('state_conflict')
  }
  return access
}

function notificationTitle(prefix: string, parentTitle: string) {
  return excerpt(`${prefix} «${parentTitle}»`, 120)
}

/**
 * Уведомления о новом сообщении (DSC-07): адресат ответа и упомянутые
 * участники, каждый не больше одного раза; себе — нет (`notify`).
 */
async function notifyRecipients(
  tx: Executor,
  values: {
    sender: ProfiledActor
    access: ParentAccess
    messageId: string
    body: string
    replyAuthorId: string | null
  },
) {
  const source = { kind: 'discussion_message', id: values.messageId }
  const body = excerpt(values.body, DISCUSSION_LIMITS.quote)
  const notified = new Set<string>([values.sender.userId])
  if (values.replyAuthorId && !notified.has(values.replyAuthorId)) {
    notified.add(values.replyAuthorId)
    await notify(tx, {
      recipientId: values.replyAuthorId,
      actorId: values.sender.userId,
      kind: 'discussion_reply',
      title: notificationTitle('Ответ в обсуждении', values.access.title),
      body,
      target: values.access.target,
      source,
    })
  }
  const candidates = mentionCandidates(values.body).slice(
    0,
    DISCUSSION_LIMITS.mentions * 2,
  )
  const targets = await repo.mentionTargets(tx, candidates)
  for (const target of targets.slice(0, DISCUSSION_LIMITS.mentions)) {
    if (notified.has(target.id)) {
      continue
    }
    notified.add(target.id)
    await notify(tx, {
      recipientId: target.id,
      actorId: values.sender.userId,
      kind: 'discussion_mention',
      title: notificationTitle('Упоминание в обсуждении', values.access.title),
      body,
      target: values.access.target,
      source,
    })
  }
}

/** Новое сообщение или ответ (DSC-03–DSC-05, DSC-07). В аудит не пишется (Q-63). */
export async function sendMessage(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<DiscussionMessage> {
  const sender = requireRole(actor, PARTICIPANTS)
  const input = parseBody(sendMessageSchema, body)
  const id = await withTransaction(deps.db, async (tx) => {
    const access = await writableParent(tx, sender, input)
    const threadId = await repo.ensureThread(tx, input.parent, input.parentId)
    let replyAuthorId: string | null = null
    if (input.replyToId) {
      const original = await repo.findMessage(tx, input.replyToId)
      if (!original || original.thread_id !== threadId) {
        throw new ApiError('validation_failed', { replyToId: 'invalid' })
      }
      replyAuthorId =
        original.author_id &&
        original.author_role &&
        (INTERNAL_ROLES as readonly string[]).includes(original.author_role)
          ? original.author_id
          : null
    }
    const at = deps.now().toISOString()
    const messageId = await repo.insertMessage(tx, {
      threadId,
      authorId: sender.userId,
      replyToId: input.replyToId,
      body: input.body,
      at,
    })
    // Своё сообщение прочитано отправителем.
    await repo.markRead(tx, { threadId, userId: sender.userId, upTo: at })
    await notifyRecipients(tx, {
      sender,
      access,
      messageId,
      body: input.body,
      replyAuthorId,
    })
    return messageId
  })
  const [message] = await toMessages(deps, sender, [
    await repo.message(deps.db, id),
  ])
  return message!
}

/** Сообщение и родитель его ветки; доступ проверяет вызывающий по родителю. */
async function messageWithParent(db: Executor, messageId: string) {
  const message = await repo.findMessage(db, messageId)
  if (!message) {
    throw new ApiError('not_found')
  }
  return { message, ref: parentOfThread(message) }
}

/**
 * Правка своего сообщения в течение 5 минут (DSC-08, DSC-09): срок
 * проверяется при сохранении; чужое сообщение не правит никто.
 */
export async function editMessage(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<DiscussionMessage> {
  const author = requireRole(actor, PARTICIPANTS)
  const input = parseBody(editMessageSchema, body)
  const { ref } = await messageWithParent(deps.db, input.messageId)
  await withTransaction(deps.db, async (tx) => {
    const access = await parentAccess(tx, author, ref, true)
    const message = await repo.lockMessage(tx, input.messageId)
    if (!message) {
      throw new ApiError('not_found')
    }
    if (message.author_id !== author.userId) {
      throw new ApiError('forbidden')
    }
    const now = deps.now()
    const expired =
      now.getTime() - parseTimestamp(message.created_at).getTime() >=
      DISCUSSION_LIMITS.editWindowMs
    if (!access.canWrite || expired) {
      throw new ApiError('state_conflict')
    }
    await repo.updateBody(tx, message.id, input.body, now.toISOString())
  })
  const [message] = await toMessages(deps, author, [
    await repo.message(deps.db, input.messageId),
  ])
  return message!
}

/** Ставит или снимает свою реакцию (DSC-11, Q-60). В аудит не пишется. */
export async function reactToMessage(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<DiscussionMessage> {
  const viewer = requireRole(actor, PARTICIPANTS)
  const input = parseBody(reactSchema, body)
  const { message, ref } = await messageWithParent(deps.db, input.messageId)
  await withTransaction(deps.db, async (tx) => {
    await writableParent(tx, viewer, ref)
    const at = deps.now().toISOString()
    await repo.toggleReaction(tx, {
      messageId: message.id,
      userId: viewer.userId,
      emoji: input.emoji,
      at,
    })
    await repo.touch(tx, message.id, at)
  })
  const [updated] = await toMessages(deps, viewer, [
    await repo.message(deps.db, message.id),
  ])
  return updated!
}

/**
 * Отметка «прочитано до» (DSC-12): только вверх и не позже текущего
 * времени. Читать можно и закрытую ветку.
 */
export async function markDiscussionRead(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<{ readUpTo: string | null }> {
  const viewer = requireRole(actor, PARTICIPANTS)
  const input = parseBody(markReadSchema, body)
  await parentAccess(deps.db, viewer, input, false)
  const threadId = await repo.findThread(deps.db, input.parent, input.parentId)
  if (!threadId) {
    return { readUpTo: null }
  }
  const now = deps.now().toISOString()
  const upTo = new Date(input.upTo).toISOString()
  const capped = upTo < now ? upTo : now
  await withTransaction(deps.db, (tx) =>
    repo.markRead(tx, { threadId, userId: viewer.userId, upTo: capped }),
  )
  return { readUpTo: capped }
}

/** Кто прочитал сообщение: автору, офицерам и администратору (Q-59). */
export async function messageReaders(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<DiscussionReaders> {
  const viewer = requireRole(actor, PARTICIPANTS)
  const { messageId } = parseBody(messageIdSchema, body)
  const { message, ref } = await messageWithParent(deps.db, messageId)
  await parentAccess(deps.db, viewer, ref, false)
  if (
    message.author_id !== viewer.userId &&
    !READ_LIST_ROLES.includes(viewer.profile.access_role)
  ) {
    throw new ApiError('forbidden')
  }
  const rows = await repo.readers(deps.db, {
    threadId: message.thread_id,
    createdAt: message.created_at,
    authorId: message.author_id,
    limit: MEMBER_LIST_LIMIT + 1,
  })
  const visible = rows.slice(0, MEMBER_LIST_LIMIT)
  const urls = await avatarUrls(
    deps.storage,
    visible.map((row) => row.avatar_path),
  )
  return {
    items: visible.map((row) => ({
      gameNickname: row.game_nickname,
      avatarUrl: row.avatar_path ? (urls.get(row.avatar_path) ?? null) : null,
    })),
    truncated: rows.length > MEMBER_LIST_LIMIT,
  }
}

/** Кто поставил реакции (DSC-11); удалённые — без ника (DSC-17). */
export async function messageReactions(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<DiscussionReactions> {
  const viewer = requireRole(actor, PARTICIPANTS)
  const { messageId } = parseBody(messageIdSchema, body)
  const { ref } = await messageWithParent(deps.db, messageId)
  await parentAccess(deps.db, viewer, ref, false)
  const rows = await repo.reactionPeople(
    deps.db,
    messageId,
    MEMBER_LIST_LIMIT + 1,
  )
  const visible = rows.slice(0, MEMBER_LIST_LIMIT)
  const urls = await avatarUrls(
    deps.storage,
    visible.map((row) => row.avatar_path),
  )
  return {
    items: visible.map((row) => ({
      emoji: row.emoji as Reaction,
      gameNickname: row.game_nickname,
      avatarUrl: row.avatar_path ? (urls.get(row.avatar_path) ?? null) : null,
    })),
    truncated: rows.length > MEMBER_LIST_LIMIT,
  }
}
