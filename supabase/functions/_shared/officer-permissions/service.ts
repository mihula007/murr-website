import type { AppDeps } from '../app.ts'
import {
  requireProfile,
  requireRole,
  type Actor,
  type ProfiledActor,
} from '../auth/actor.ts'
import { auditPerson, writeAudit } from '../audit/service.ts'
import {
  OFFICER_PERMISSION_CODES,
  OFFICER_PERMISSION_LABELS,
  officerPermissionsSaveSchema,
  type OfficerPermissionCode,
  type OfficerPermissionsResponse,
  type OfficerPermissionsRosterResponse,
} from '../contracts/officer-permissions.ts'
import { withTransaction } from '../db/client.ts'
import { ApiError } from '../http/errors.ts'
import { parseBody } from '../http/validation.ts'
import { officerPermissionsRepository } from './repository.ts'
import type { ApiErrorCode } from '../contracts/errors.ts'

const MANAGERS = ['master', 'admin'] as const

const error = (code: ApiErrorCode) => new ApiError(code)

/** Включённые права конкретного офицера; прочие роли всегда обходятся настройкой. */
export async function getOfficerPermissions(
  deps: AppDeps,
  officerId: string,
): Promise<OfficerPermissionCode[]> {
  const rows = await officerPermissionsRepository.listForOfficer(
    deps.db,
    officerId,
  )
  return rows.map((row) => row.permission_code as OfficerPermissionCode)
}

/** Единая серверная проверка: мастер и администратор сохраняют полный доступ. */
export async function requireOfficerPermission(
  deps: AppDeps,
  actor: Actor,
  permission: OfficerPermissionCode,
): Promise<ProfiledActor> {
  const user = requireProfile(actor)
  if (
    user.profile.access_role === 'master' ||
    user.profile.access_role === 'admin'
  ) {
    return user
  }
  if (user.profile.access_role !== 'officer') {
    throw error('forbidden')
  }
  if (
    !(await officerPermissionsRepository.has(deps.db, user.userId, permission))
  ) {
    throw error('forbidden')
  }
  return user
}

/** Проверяет видимость дополнительной информации без отказа обычным членам. */
export async function hasOfficerPermission(
  deps: AppDeps,
  actor: Actor,
  permission: OfficerPermissionCode,
): Promise<boolean> {
  const user = requireProfile(actor)
  if (
    user.profile.access_role === 'master' ||
    user.profile.access_role === 'admin'
  ) {
    return true
  }
  if (user.profile.access_role !== 'officer') {
    return false
  }
  return officerPermissionsRepository.has(deps.db, user.userId, permission)
}

/** Список для селектора «Мастерки»: лимит офицеров закреплён в OFP-01. */
export async function listOfficerPermissions(
  deps: AppDeps,
  actor: Actor,
): Promise<OfficerPermissionsRosterResponse> {
  requireRole(actor, MANAGERS)
  const officers = await officerPermissionsRepository.listOfficers(deps.db)
  const rows = await officerPermissionsRepository.listEnabled(
    deps.db,
    officers.map((officer) => officer.id),
  )
  const byOfficer = new Map<string, OfficerPermissionCode[]>()
  for (const row of rows) {
    const list = byOfficer.get(row.officer_id) ?? []
    list.push(row.permission_code as OfficerPermissionCode)
    byOfficer.set(row.officer_id, list)
  }
  return {
    officers: officers.map((officer) => ({
      id: officer.id,
      nickname: officer.game_nickname,
      permissions: byOfficer.get(officer.id) ?? [],
    })),
  }
}

/** Сохраняет набор прав целиком и пишет аудит по каждой изменённой строке. */
export async function saveOfficerPermissions(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<OfficerPermissionsResponse> {
  const manager = requireRole(actor, MANAGERS)
  const input = parseBody(officerPermissionsSaveSchema, body)
  const next = new Set(input.permissions)
  const applicationActions = [
    'applications.submit_vote',
    'applications.decide_after_vote',
    'applications.decide_direct',
  ] as const
  if (
    !next.has('applications.review') &&
    applicationActions.some((code) => next.has(code))
  ) {
    throw error('validation_failed')
  }

  return withTransaction(deps.db, async (tx) => {
    const officer = await officerPermissionsRepository.findOfficerForUpdate(
      tx,
      input.officerId,
    )
    if (!officer || officer.access_role !== 'officer') {
      throw error('not_found')
    }

    const currentRows = await officerPermissionsRepository.listForOfficer(
      tx,
      officer.id,
    )
    const current = new Set(
      currentRows.map((row) => row.permission_code as OfficerPermissionCode),
    )
    const changed = OFFICER_PERMISSION_CODES.filter(
      (code) => current.has(code) !== next.has(code),
    )

    for (const code of changed) {
      const enabled = next.has(code)
      if (enabled) {
        await officerPermissionsRepository.insert(tx, officer.id, code)
      } else {
        await officerPermissionsRepository.delete(tx, officer.id, code)
      }
      await writeAudit(tx, {
        category: 'officer_permissions',
        action: enabled
          ? 'officer_permission_enabled'
          : 'officer_permission_disabled',
        summary: `${enabled ? 'Включено' : 'Выключено'} право «${OFFICER_PERMISSION_LABELS[code]}» для ${officer.game_nickname}`,
        actor: auditPerson(manager),
        target: {
          kind: 'officer',
          id: officer.id,
          user: {
            id: officer.id,
            role: 'officer',
            nickname: officer.game_nickname,
            email: null,
          },
        },
        details: { permission_code: code, enabled },
      })
    }

    return {
      officer: { id: officer.id, nickname: officer.game_nickname },
      permissions: [...next].sort(),
    }
  })
}
