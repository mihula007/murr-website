import type { Actor } from '../auth/actor.ts'
import { requireRole } from '../auth/actor.ts'
import {
  KH_QUEUE_IDS,
  khQueueActionSchema,
  khQueueEntryActionSchema,
  khQueueEntryIdSchema,
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
          })),
          nextCursor: page.nextCursor,
        },
      ] as const
    }),
  )
  return { queues: Object.fromEntries(pages) } as KhQueuesResponse
}

export async function joinKhQueue(deps: AppDeps, actor: Actor, body: unknown) {
  const member = requireRole(actor, JOIN_ROLES)
  const { queueKey } = parseBody(khQueueActionSchema, body)
  return withTransaction(deps.db, async (tx) => {
    const row = await khQueueRepository.join(tx, queueKey, member.userId)
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
    const row = await khQueueRepository.leave(
      tx,
      queueKey,
      entryId,
      member.userId,
    )
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
    const row = await khQueueRepository.issue(tx, queueKey, entryId)
    if (!row) {
      throw new ApiError('not_found')
    }
    return { ok: true }
  })
}
