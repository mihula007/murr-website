import type { Actor } from '../auth/actor.ts'
import { requireRole } from '../auth/actor.ts'
import {
  KH_QUEUE_IDS,
  khQueueActionSchema,
  khQueueEntryActionSchema,
  khQueueEntryIdSchema,
  khQueueLimitSchema,
  khQueueRepeatSchema,
  khQueuesRequestSchema,
  type KhQueuesResponse,
} from '../contracts/kh.ts'
import { PAGE_SIZE } from '../contracts/paging.ts'
import type { AppDeps } from '../app.ts'
import { withTransaction } from '../db/client.ts'
import { ApiError } from '../http/errors.ts'
import { decodeCursor, splitPage } from '../http/cursor.ts'
import { parseBody } from '../http/validation.ts'
import { khQueueRepository } from './repository.ts'
import { z } from 'zod'

const cursorSchema = z.tuple([khQueueEntryIdSchema])
const READ_ROLES = ['member', 'officer', 'master', 'admin'] as const
const JOIN_ROLES = ['member', 'officer', 'admin'] as const
const MANAGE_ROLES = ['master', 'admin'] as const

export async function listKhQueues(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<KhQueuesResponse> {
  requireRole(actor, READ_ROLES)
  const input = parseBody(khQueuesRequestSchema, body)
  const pages = await Promise.all(
    KH_QUEUE_IDS.map(async (queueKey) => {
      const cursor = input.cursors?.[queueKey]
      if (input.cursors !== undefined && !cursor) {
        return [queueKey, { items: [], nextCursor: null }] as const
      }
      const afterId = cursor ? decodeCursor(cursorSchema, cursor)[0] : null
      const rows = await khQueueRepository.listPage(
        deps.db,
        queueKey,
        afterId,
        PAGE_SIZE + 1,
      )
      const page = splitPage(rows, PAGE_SIZE, (row) => [String(row.id)])
      return [
        queueKey,
        {
          items: page.rows.map((row) => ({
            id: String(row.id),
            userId: row.user_id,
            gameNickname: row.game_nickname,
            autoRejoin: row.auto_rejoin,
          })),
          nextCursor: page.nextCursor,
        },
      ] as const
    }),
  )
  return { queues: Object.fromEntries(pages) } as KhQueuesResponse
}

export async function getKhQueueSettings(deps: AppDeps, actor: Actor) {
  const user = requireRole(actor, READ_ROLES)
  const settings = await khQueueRepository.settings(deps.db)
  const activeQueueCount =
    user.profile.access_role === 'master'
      ? 0
      : await khQueueRepository.countEntries(deps.db, user.userId)
  return { maxActiveQueues: settings.maxActiveQueues, activeQueueCount }
}

export async function setKhQueueLimit(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
) {
  requireRole(actor, MANAGE_ROLES)
  const { maxActiveQueues } = parseBody(khQueueLimitSchema, body)
  return withTransaction(deps.db, async (tx) => {
    await khQueueRepository.lockSettings(tx, 'update')
    await khQueueRepository.setLimit(tx, maxActiveQueues)
    return { maxActiveQueues }
  })
}

export async function joinKhQueue(deps: AppDeps, actor: Actor, body: unknown) {
  const member = requireRole(actor, JOIN_ROLES)
  const { queueKey } = parseBody(khQueueActionSchema, body)
  return withTransaction(deps.db, async (tx) => {
    const cap = await khQueueRepository.lockSettings(tx, 'share')
    const row = await khQueueRepository.join(
      tx,
      queueKey,
      member.userId,
      member.profile.game_nickname,
      cap,
    )
    if (!row) {
      throw new ApiError('state_conflict')
    }
    return { entryId: String(row.id) }
  })
}

export async function leaveKhQueue(deps: AppDeps, actor: Actor, body: unknown) {
  const member = requireRole(actor, JOIN_ROLES)
  const { queueKey, entryId } = parseBody(khQueueEntryActionSchema, body)
  return withTransaction(deps.db, async (tx) => {
    const cap = await khQueueRepository.lockSettings(tx, 'share')
    await khQueueRepository.lockUser(tx, member.userId)
    const row = await khQueueRepository.leave(
      tx,
      queueKey,
      entryId,
      member.userId,
      cap,
    )
    if (!row) {
      throw new ApiError('not_found')
    }
    return { ok: true }
  })
}

export async function setKhQueueRepeat(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
) {
  const member = requireRole(actor, JOIN_ROLES)
  const input = parseBody(khQueueRepeatSchema, body)
  return withTransaction(deps.db, async (tx) => {
    await khQueueRepository.lockUser(tx, member.userId)
    const row = await khQueueRepository.setRepeat(
      tx,
      input.queueKey,
      input.entryId,
      member.userId,
      input.autoRejoin,
    )
    if (!row) {
      throw new ApiError('not_found')
    }
    return { autoRejoin: input.autoRejoin }
  })
}

export async function removeKhQueueEntry(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
) {
  requireRole(actor, ['master'])
  const { queueKey, entryId } = parseBody(khQueueEntryActionSchema, body)
  return withTransaction(deps.db, async (tx) => {
    const cap = await khQueueRepository.lockSettings(tx, 'share')
    const first = await khQueueRepository.entryById(tx, queueKey, entryId)
    if (!first) {
      throw new ApiError('not_found')
    }
    if (first.user_id) {
      await khQueueRepository.lockUser(tx, first.user_id)
    }
    const entry = await khQueueRepository.lockEntryById(tx, queueKey, entryId)
    if (!entry) {
      throw new ApiError('not_found')
    }
    const row = await khQueueRepository.remove(tx, entry, cap)
    if (!row) {
      throw new ApiError('not_found')
    }
    return { ok: true }
  })
}

export async function issueKhReward(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
) {
  requireRole(actor, ['master'])
  const { queueKey, entryId } = parseBody(khQueueEntryActionSchema, body)
  return withTransaction(deps.db, async (tx) => {
    const cap = await khQueueRepository.lockSettings(tx, 'share')
    const first = await khQueueRepository.entryById(tx, queueKey, entryId)
    if (!first) {
      throw new ApiError('not_found')
    }
    if (first.user_id) {
      await khQueueRepository.lockUser(tx, first.user_id)
    }
    const entry = await khQueueRepository.lockEntryById(tx, queueKey, entryId)
    if (!entry) {
      throw new ApiError('not_found')
    }
    const row = await khQueueRepository.issue(tx, entry, cap)
    if (!row) {
      throw new ApiError('not_found')
    }
    return { ok: true }
  })
}
