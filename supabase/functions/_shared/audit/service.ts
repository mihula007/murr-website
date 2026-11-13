import { z } from 'zod'
import type { AppDeps } from '../app.ts'
import { requireRole, type Actor, type ProfiledActor } from '../auth/actor.ts'
import {
  auditListSchema,
  type AuditCategory,
  type AuditListResponse,
} from '../contracts/audit.ts'
import type { Executor } from '../db/client.ts'
import type { AccessRole } from '../db/schema.ts'
import { decodeCursor, splitPage } from '../http/cursor.ts'
import { parseBody } from '../http/validation.ts'
import { auditRepository } from './repository.ts'

export type { AuditCategory }

/** Разрешённые ключи details: без паролей, кодов, токенов и текстов анкеты. */
const DETAIL_KEYS = new Set([
  'profile_id',
  'application_id',
  'changed_fields',
  'role',
  'previous_role',
  'decision',
  'user_id',
  'vote_id',
  'vote_kind',
  'title',
  'event_id',
  'event_type',
  'starts_at',
  'template_id',
  'presets',
  'visited',
  'missed',
  'unmarked',
  'publication_id',
  'listing_id',
  'category',
  'status',
  'draft_id',
  'channels',
  'source_kind',
])

type DetailValue = string | number | boolean | null | string[]

export type AuditPerson = {
  /** null — связи с профилем нет (запись об удалении пользователя). */
  id: string | null
  role?: AccessRole | null
  nickname: string | null
  email: string | null
}

export type AuditEvent = {
  category: AuditCategory
  action: string
  summary: string
  actor: AuditPerson | null
  target?: { kind: string; id: string; user?: AuditPerson }
  details?: Record<string, DetailValue>
}

/** Исполнитель операции для записи аудита. */
export function auditPerson(actor: ProfiledActor): AuditPerson {
  return {
    id: actor.userId,
    role: actor.profile.access_role as AccessRole,
    nickname: actor.profile.game_nickname,
    email: actor.email,
  }
}

export function assertAuditDetails(details: Record<string, DetailValue>) {
  for (const key of Object.keys(details)) {
    if (!DETAIL_KEYS.has(key)) {
      throw new Error(`Ключ details аудита не разрешён: ${key}`)
    }
  }
}

/**
 * Единая точка записи аудита (ADM-11). Вызывается внутри транзакции операции,
 * поэтому событие фиксируется или откатывается вместе с изменением.
 */
export async function writeAudit(tx: Executor, event: AuditEvent) {
  const details = event.details ?? {}
  assertAuditDetails(details)
  await auditRepository.lock(tx)
  const row = await auditRepository.insert(tx, {
    category: event.category,
    action: event.action,
    summary: event.summary,
    actor_id: event.actor?.id ?? null,
    actor_role: event.actor?.role ?? null,
    actor_nickname: event.actor?.nickname ?? null,
    actor_email: event.actor?.email ?? null,
    target_kind: event.target?.kind ?? null,
    target_id: event.target?.id ?? null,
    target_user_id: event.target?.user?.id ?? null,
    target_nickname: event.target?.user?.nickname ?? null,
    target_email: event.target?.user?.email ?? null,
    details,
  })
  await auditRepository.trimToLatest(tx)
  return row.id
}

/** Курсор журнала: `[id]` последней записи (id растёт со временем). */
const auditCursor = z.tuple([z.number().int().positive()])

/** Журнал действий администратора (ADM-10, ADM-12, Q-68). */
export async function listAudit(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<AuditListResponse> {
  requireRole(actor, ['admin'])
  const input = parseBody(auditListSchema, body ?? {})
  const rows = await auditRepository.list(deps.db, {
    category: input.category,
    search: input.search,
    beforeId: input.cursor ? decodeCursor(auditCursor, input.cursor)[0] : null,
    limit: input.limit + 1,
  })
  const page = splitPage(rows, input.limit, (row) => [Number(row.id)])
  return {
    nextCursor: page.nextCursor,
    items: page.rows.map((row) => ({
      id: Number(row.id),
      createdAt: row.created_at,
      category: row.category as AuditCategory,
      action: row.action,
      summary: row.summary,
      actor:
        row.actor_nickname || row.actor_email
          ? {
              nickname: row.actor_nickname,
              role: row.actor_role,
              email: row.actor_email,
            }
          : null,
      target:
        row.target_kind && row.target_id
          ? {
              kind: row.target_kind,
              id: row.target_id,
              nickname: row.target_nickname,
              email: row.target_email,
            }
          : null,
      details: row.details as Record<string, unknown>,
    })),
  }
}
