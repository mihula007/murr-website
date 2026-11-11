import type { ProfiledActor } from '../auth/actor.ts'
import type { Executor } from '../db/client.ts'
import type { AccessRole } from '../db/schema.ts'
import { auditRepository } from './repository.ts'

export type AuditCategory =
  | 'applications'
  | 'participants'
  | 'profiles'
  | 'events'
  | 'votes'
  | 'publications'
  | 'market'
  | 'broadcast'

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
])

type DetailValue = string | number | boolean | null | string[]

export type AuditPerson = {
  id: string
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
