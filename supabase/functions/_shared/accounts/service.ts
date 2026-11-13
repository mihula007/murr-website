import { profileRepository } from '../account/repository.ts'
import type { AppDeps } from '../app.ts'
import { applicationRepository } from '../applications/repository.ts'
import { auditPerson, writeAudit } from '../audit/service.ts'
import { requireRole, type Actor, type ProfiledActor } from '../auth/actor.ts'
import { userRepository } from '../auth/repository.ts'
import type { AccessRole } from '../contracts/account.ts'
import {
  accountsListSchema,
  restoreReaderSchema,
  setRoleSchema,
  type AccountsListResponse,
  type RoleChangeResult,
} from '../contracts/accounts.ts'
import { withTransaction, type Executor } from '../db/client.ts'
import type { ProfileRow } from '../db/schema.ts'
import { decodeCursor, splitPage } from '../http/cursor.ts'
import { ApiError } from '../http/errors.ts'
import { parseBody } from '../http/validation.ts'
import { joinedOnAfterRoleChange, moscowDate } from '../membership.ts'
import { notify } from '../notifications/service.ts'
import { nicknameCursor, nicknameKey } from '../roster/cursor.ts'
import { accountRepository } from './repository.ts'

/** Восстанавливают чтеца офицер и администратор (ACL-06, ADM-09). */
const READER_KEEPERS = ['officer', 'admin'] as const

/** Страница таблицы аккаунтов администратора; поиск — этап 11, на сервере. */
export async function listAccounts(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<AccountsListResponse> {
  requireRole(actor, ['admin'])
  const { cursor, limit } = parseBody(accountsListSchema, body ?? {})
  const rows = await accountRepository.listPage(
    deps.db,
    cursor ? decodeCursor(nicknameCursor, cursor) : null,
    limit + 1,
  )
  const page = splitPage(rows, limit, (row) =>
    nicknameKey(row.game_nickname, row.id),
  )
  return {
    nextCursor: page.nextCursor,
    items: page.rows.map((row) => ({
      id: row.id,
      gameNickname: row.game_nickname,
      displayName: row.display_name,
      email: row.email ?? '',
      role: row.access_role as AccessRole,
      joinedOn: row.joined_on,
      isPrimaryAdmin: row.is_primary_admin,
      hasActiveApplication: Boolean(row.has_active_application),
    })),
  }
}

const ROLE_AUDIT = {
  blocked: { action: 'member_blocked', summary: 'Блокировка' },
  changed: { action: 'role_changed', summary: 'Смена роли' },
  restored: { action: 'reader_restored', summary: 'Восстановление чтеца' },
} as const

/** Названия ролей в уведомлении о смене роли (NTF-03). */
const ROLE_NAMES: Record<AccessRole, string> = {
  applicant: 'Кандидат',
  reader: 'Чтец',
  member: 'Член клана',
  officer: 'Офицер',
  admin: 'Администратор',
}

/**
 * Записывает новую роль и дату вступления (правило — `membership.ts`) и аудит
 * в открытой транзакции; профиль цели уже заблокирован.
 */
async function applyRole(
  tx: Executor,
  deps: AppDeps,
  executor: ProfiledActor,
  target: ProfileRow,
  role: AccessRole,
  audit: (typeof ROLE_AUDIT)[keyof typeof ROLE_AUDIT],
): Promise<RoleChangeResult> {
  const now = deps.now()
  const previousRole = target.access_role as AccessRole
  const joinedOn = joinedOnAfterRoleChange(
    previousRole,
    role,
    target.joined_on,
    moscowDate(now),
  )
  await profileRepository.update(tx, target.id, {
    access_role: role,
    joined_on: joinedOn,
    updated_at: now.toISOString(),
  })
  const user = await userRepository.findById(tx, target.id)
  await writeAudit(tx, {
    category: 'participants',
    action: audit.action,
    summary: audit.summary,
    actor: auditPerson(executor),
    target: {
      kind: 'profile',
      id: target.id,
      user: {
        id: target.id,
        role,
        nickname: target.game_nickname,
        email: user?.email ?? null,
      },
    },
    details: { user_id: target.id, previous_role: previousRole, role },
  })
  // Каждая смена — отдельное уведомление; источник включает время смены.
  await notify(tx, {
    recipientId: target.id,
    actorId: executor.userId,
    kind: 'role_changed',
    title: 'Ваша роль изменена',
    body: `${ROLE_NAMES[previousRole]} → ${ROLE_NAMES[role]}`,
    target: { kind: 'account', id: target.id },
    source: { kind: 'role_change', id: `${target.id}:${now.toISOString()}` },
  })
  return { userId: target.id, role, joinedOn }
}

/**
 * Смена роли и блокировка (перевод в чтеца) администратором (ADM-04, ADM-08).
 * Основного и последнего администратора понизить нельзя (ACL-07, ADM-06);
 * роль кандидата с активной заявкой меняется только решением по заявке.
 * Та же роль — без изменений и без аудита.
 */
export async function setRole(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<RoleChangeResult> {
  const admin = requireRole(actor, ['admin'])
  const { userId, role } = parseBody(setRoleSchema, body)

  return withTransaction(deps.db, async (tx) => {
    // Сначала администраторы, затем цель: один порядок блокировок для всех.
    const admins = await accountRepository.lockAdmins(tx)
    const target = await profileRepository.findByIdForUpdate(tx, userId)
    if (!target) {
      throw new ApiError('not_found')
    }
    const previousRole = target.access_role as AccessRole
    if (previousRole === role) {
      return { userId, role, joinedOn: target.joined_on }
    }
    if (previousRole === 'admin') {
      if (target.is_primary_admin) {
        throw new ApiError('primary_admin')
      }
      if (!admins.some((other) => other.id !== target.id)) {
        throw new ApiError('last_admin')
      }
    }
    if (await applicationRepository.hasActive(tx, userId)) {
      throw new ApiError('application_pending')
    }
    return applyRole(
      tx,
      deps,
      admin,
      target,
      role,
      role === 'reader' ? ROLE_AUDIT.blocked : ROLE_AUDIT.changed,
    )
  })
}

/** Восстановление чтеца в роли члена с датой вступления — сегодня (ACL-06). */
export async function restoreReader(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<RoleChangeResult> {
  const keeper = requireRole(actor, READER_KEEPERS)
  const { userId } = parseBody(restoreReaderSchema, body)

  return withTransaction(deps.db, async (tx) => {
    const target = await profileRepository.findByIdForUpdate(tx, userId)
    if (!target) {
      throw new ApiError('not_found')
    }
    if (target.access_role !== 'reader') {
      throw new ApiError('state_conflict')
    }
    return applyRole(tx, deps, keeper, target, 'member', ROLE_AUDIT.restored)
  })
}
