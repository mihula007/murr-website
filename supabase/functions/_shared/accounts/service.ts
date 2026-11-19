import { z } from 'zod'
import { avatarUrl } from '../account/avatars.ts'
import {
  NICKNAME_CONSTRAINT,
  profileRepository,
  type ProfileUpdate,
} from '../account/repository.ts'
import type { AppDeps } from '../app.ts'
import { applicationRepository } from '../applications/repository.ts'
import { catalogRepository } from '../catalog/repository.ts'
import { auditPerson, writeAudit } from '../audit/service.ts'
import { requireRole, type Actor, type ProfiledActor } from '../auth/actor.ts'
import { requireOfficerPermission } from '../officer-permissions/service.ts'
import {
  OFFICER_PERMISSION_LABELS,
  type OfficerPermissionCode,
} from '../contracts/officer-permissions.ts'
import { officerPermissionsRepository } from '../officer-permissions/repository.ts'
import { userRepository } from '../auth/repository.ts'
import type { AccessRole, ApplicationStatus } from '../contracts/account.ts'
import {
  accountIdSchema,
  accountsListSchema,
  restoreReaderSchema,
  setPasswordSchema,
  setProfileSchema,
  setRoleSchema,
  type AccountCard,
  type AccountListItem,
  type AccountsListResponse,
  type RoleChangeResult,
  type SetPasswordResult,
  type SetProfileRequest,
  type SetProfileResult,
} from '../contracts/accounts.ts'
import {
  CHARACTER_STAT_FIELDS,
  CHARACTER_STAT_LABELS,
  setCharacterStatSchema,
  setCharacterStatsSchema,
  type CharacterStatField,
  type SetCharacterStatResult,
  type SetCharacterStatsCommand,
  type SetCharacterStatsResult,
} from '../contracts/character-stats.ts'
import { withTransaction, type Executor } from '../db/client.ts'
import { isUniqueViolation } from '../db/errors.ts'
import type { ProfileRow } from '../db/schema.ts'
import { decodeCursor, splitPage } from '../http/cursor.ts'
import { ApiError } from '../http/errors.ts'
import { parseBody } from '../http/validation.ts'
import { joinedOnAfterRoleChange, moscowDate } from '../membership.ts'
import { notify } from '../notifications/service.ts'
import { accountRepository, type AccountKey } from './repository.ts'

/** Восстанавливают чтеца офицер и администратор (ACL-06, ADM-09). */
const READER_KEEPERS = ['officer', 'master', 'admin'] as const

/** Курсор таблицы аккаунтов: `[значение сортировки, id]`. */
const accountCursor = z
  .tuple([z.union([z.string().max(400), z.number()]), z.guid()])
  .transform(([value, id]): AccountKey => ({ value, id }))

type AccountRow = NonNullable<
  Awaited<ReturnType<typeof accountRepository.findById>>
>

function accountItem(row: AccountRow): AccountListItem {
  return {
    id: row.id,
    gameNickname: row.game_nickname,
    displayName: row.display_name,
    email: row.email ?? '',
    className: row.class_name,
    role: row.access_role as AccessRole,
    registeredAt: row.created_at,
    joinedOn: row.joined_on,
    applicationStatus: (row.application_status ??
      null) as ApplicationStatus | null,
    isPrimaryAdmin: row.is_primary_admin,
    hasActiveApplication: Boolean(row.has_active_application),
    deletionPending: Boolean(row.deletion_pending),
  }
}

/**
 * Таблица аккаунтов администратора (ADM-01, ADM-02): поиск по нику, имени,
 * email и классу, сортировка и курсор — на сервере; `total` — по поиску.
 */
export async function listAccounts(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<AccountsListResponse> {
  requireRole(actor, ['admin'])
  const input = parseBody(accountsListSchema, body ?? {})
  const query = {
    search: input.search,
    classId: input.classId ?? null,
    role: input.role ?? null,
    sort: input.sort,
    direction: input.direction,
  }
  const [rows, total] = await Promise.all([
    accountRepository.listPage(
      deps.db,
      query,
      input.cursor ? decodeCursor(accountCursor, input.cursor) : null,
      input.limit + 1,
    ),
    accountRepository.count(deps.db, query),
  ])
  const page = splitPage(rows, input.limit, (row) => [row.sort_key, row.id])
  return {
    nextCursor: page.nextCursor,
    total,
    items: page.rows.map(accountItem),
  }
}

/** Раскрытая карточка аккаунта со всеми данными (ADM-03). */
export async function getAccount(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<AccountCard> {
  requireRole(actor, ['admin'])
  const { userId } = parseBody(accountIdSchema, body)
  const [row, card, links] = await Promise.all([
    accountRepository.findById(deps.db, userId),
    accountRepository.card(deps.db, userId),
    accountRepository.latestApplicationLinks(deps.db, userId),
  ])
  if (!row || !card) {
    throw new ApiError('not_found')
  }
  return {
    ...accountItem(row),
    classId: card.class_id,
    city: card.city,
    birthDate: card.birth_date,
    about: card.about,
    avatarUrl: await avatarUrl(deps.storage, card.avatar_path),
    pa: card.pa === null ? null : Number(card.pa),
    pz: card.pz === null ? null : Number(card.pz),
    bu: card.bu === null ? null : Number(card.bu),
    hp: card.hp === null ? null : Number(card.hp),
    bd: card.bd === null ? null : Number(card.bd),
    characterStatsSource: card.character_stats_source,
    equipmentLinks: links,
    passwordSet: card.password_set,
  }
}

/** Изменение ника и класса любого аккаунта администратором (ADM-16). */
export async function setAccountProfile(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<SetProfileResult> {
  const admin = requireRole(actor, ['admin'])
  const command: SetProfileRequest = parseBody(setProfileSchema, body)
  try {
    return await withTransaction(deps.db, async (tx) => {
      const target = await profileRepository.findByIdForUpdate(
        tx,
        command.userId,
      )
      if (!target) {
        throw new ApiError('not_found')
      }
      if (await userRepository.deletionPending(tx, command.userId)) {
        throw new ApiError('state_conflict')
      }
      if (!(await catalogRepository.isActiveClass(tx, command.classId))) {
        throw new ApiError('validation_failed', { classId: 'required' })
      }
      if (
        await profileRepository.nicknameTaken(
          tx,
          command.gameNickname,
          command.userId,
        )
      ) {
        throw new ApiError('validation_failed', {
          gameNickname: 'nickname_taken',
        })
      }

      const changes: ProfileUpdate = {}
      const changedFields: string[] = []
      if (command.gameNickname !== target.game_nickname) {
        changes.game_nickname = command.gameNickname
        changedFields.push('game_nickname')
      }
      if (command.classId !== target.class_id) {
        changes.class_id = command.classId
        changedFields.push('class_id')
      }
      if (changedFields.length > 0) {
        await profileRepository.update(tx, target.id, {
          ...changes,
          updated_at: deps.now().toISOString(),
        })
        const user = await userRepository.findById(tx, target.id)
        await writeAudit(tx, {
          category: 'profiles',
          action: 'profile_updated',
          summary: 'Изменение профиля',
          actor: auditPerson(admin),
          target: {
            kind: 'profile',
            id: target.id,
            user: {
              id: target.id,
              role: target.access_role as AccessRole,
              nickname: command.gameNickname,
              email: user?.email ?? null,
            },
          },
          details: {
            user_id: target.id,
            changed_fields: changedFields,
          },
        })
      }
      return {
        userId: target.id,
        gameNickname: command.gameNickname,
        classId: command.classId,
      }
    })
  } catch (error) {
    if (isUniqueViolation(error, NICKNAME_CONSTRAINT)) {
      throw new ApiError('validation_failed', {
        gameNickname: 'nickname_taken',
      })
    }
    throw error
  }
}

const CHARACTER_STAT_COLUMNS = {
  pa: 'pa',
  pz: 'pz',
  bu: 'bu',
  hp: 'hp',
  bd: 'bd',
  source: 'character_stats_source',
} as const satisfies Record<CharacterStatField, keyof ProfileRow>

const STAT_FIELDS: CharacterStatField[] = [...CHARACTER_STAT_FIELDS, 'source']

function savedStat(target: ProfileRow, field: CharacterStatField) {
  const value = target[CHARACTER_STAT_COLUMNS[field]]
  if (value === null || field === 'source') {
    return value as string | null
  }
  return Number(value)
}

/** Значение для журнала: пустое — тире, источник — в кавычках. */
function auditStatValue(
  field: CharacterStatField,
  value: number | string | null,
) {
  if (value === null) {
    return '—'
  }
  return field === 'source' ? `«${value}»` : String(value)
}

/**
 * Сохранение блока характеристик (ADM-15): только администратор. Меняются
 * только переданные поля с новым значением; одна запись аудита на
 * сохранение с прежним и новым значением каждого изменённого поля.
 */
async function saveCharacterStats(
  deps: AppDeps,
  admin: ProfiledActor,
  command: SetCharacterStatsCommand,
): Promise<SetCharacterStatsResult> {
  return withTransaction(deps.db, async (tx) => {
    const target = await profileRepository.findByIdForUpdate(tx, command.userId)
    if (!target) {
      throw new ApiError('not_found')
    }
    if (await userRepository.deletionPending(tx, command.userId)) {
      throw new ApiError('state_conflict')
    }

    const changes: ProfileUpdate = {}
    const changedFields: string[] = []
    const statChanges: string[] = []
    for (const field of STAT_FIELDS) {
      const next = command[field]
      const previous = savedStat(target, field)
      if (next === undefined || next === previous) {
        continue
      }
      Object.assign(changes, { [CHARACTER_STAT_COLUMNS[field]]: next })
      const label = CHARACTER_STAT_LABELS[field]
      changedFields.push(label)
      statChanges.push(
        `${label}: ${auditStatValue(field, previous)} → ${auditStatValue(field, next)}`,
      )
    }

    if (changedFields.length > 0) {
      await profileRepository.update(tx, command.userId, {
        ...changes,
        updated_at: deps.now().toISOString(),
      })
      const user = await userRepository.findById(tx, command.userId)
      await writeAudit(tx, {
        category: 'profiles',
        action: 'character_stat_changed',
        summary: 'Изменение характеристики персонажа',
        actor: auditPerson(admin),
        target: {
          kind: 'profile',
          id: command.userId,
          user: {
            id: command.userId,
            role: target.access_role as AccessRole,
            nickname: target.game_nickname,
            email: user?.email ?? null,
          },
        },
        details: {
          user_id: command.userId,
          changed_fields: changedFields,
          stat_changes: statChanges,
        },
      })
    }

    const stat = (field: CharacterStatField) =>
      command[field] === undefined ? savedStat(target, field) : command[field]
    return {
      userId: command.userId,
      pa: stat('pa') as number | null,
      pz: stat('pz') as number | null,
      bu: stat('bu') as number | null,
      hp: stat('hp') as number | null,
      bd: stat('bd') as number | null,
      characterStatsSource: stat('source') as string | null,
    }
  })
}

/** Блок «Характеристика персонажа» одним сохранением (ADM-15). */
export async function setCharacterStats(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<SetCharacterStatsResult> {
  const admin = requireRole(actor, ['admin'])
  return saveCharacterStats(
    deps,
    admin,
    parseBody(setCharacterStatsSchema, body),
  )
}

/**
 * Прежняя операция одного поля — для клиента, выложенного до сохранения
 * блока; пишет тот же аудит, что и `setCharacterStats`.
 */
export async function setCharacterStat(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<SetCharacterStatResult> {
  const admin = requireRole(actor, ['admin'])
  const command = parseBody(setCharacterStatSchema, body)
  await saveCharacterStats(deps, admin, {
    userId: command.userId,
    [command.field]: command.value,
  })
  return command
}

/**
 * Новый пароль другого аккаунта (ADM-07, Q-72): не свой и не основного
 * администратора. Auth завершает все сеансы цели; пароль не пишется в аудит.
 */
export async function setPassword(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<SetPasswordResult> {
  const admin = requireRole(actor, ['admin'])
  const { userId, password } = parseBody(setPasswordSchema, body)
  if (userId === admin.userId) {
    throw new ApiError('forbidden')
  }
  const target = await accountRepository.findById(deps.db, userId)
  if (!target) {
    throw new ApiError('not_found')
  }
  if (target.is_primary_admin) {
    throw new ApiError('primary_admin')
  }
  if (target.deletion_pending) {
    throw new ApiError('state_conflict')
  }
  await deps.authAdmin.setPassword(userId, password)
  await withTransaction(deps.db, (tx) =>
    writeAudit(tx, {
      category: 'participants',
      action: 'password_changed',
      summary: 'Смена пароля аккаунта',
      actor: auditPerson(admin),
      target: {
        kind: 'profile',
        id: userId,
        user: {
          id: userId,
          role: target.access_role as AccessRole,
          nickname: target.game_nickname,
          email: target.email,
        },
      },
      details: { user_id: userId },
    }),
  )
  return { userId }
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
  master: 'Мастер',
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
 * Администратор управляет ролями; офицер переводит члена в чтеца, мастер
 * меняет роли членам и чтецам и понижает офицеров (ROS-07, ROS-12).
 * Основного и последнего администратора понизить нельзя (ACL-07, ADM-06);
 * роль кандидата с активной заявкой меняется только решением по заявке.
 * Та же роль — без изменений и без аудита.
 */
export async function setRole(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<RoleChangeResult> {
  const manager = requireRole(actor, ['officer', 'master', 'admin'])
  await requireOfficerPermission(deps, manager, 'roster.reader_roles')
  const { userId, role } = parseBody(setRoleSchema, body)

  return withTransaction(deps.db, async (tx) => {
    // Сначала администраторы, затем цель: один порядок блокировок для всех.
    const admins = await accountRepository.lockAdmins(tx)
    const target = await profileRepository.findByIdForUpdate(tx, userId)
    if (!target) {
      throw new ApiError('not_found')
    }
    // Удаляемый аккаунт не меняет роль: удаление не обходит запрет Q-73.
    if (await userRepository.deletionPending(tx, userId)) {
      throw new ApiError('state_conflict')
    }
    const previousRole = target.access_role as AccessRole
    if (manager.profile.access_role === 'master') {
      const masterRoleChoices: Partial<
        Record<AccessRole, readonly AccessRole[]>
      > = {
        member: ['officer', 'reader'],
        officer: ['member', 'reader'],
        reader: ['member', 'officer'],
      }
      if (!masterRoleChoices[previousRole]?.includes(role)) {
        throw new ApiError('forbidden')
      }
    } else if (
      manager.profile.access_role !== 'admin' &&
      (previousRole !== 'member' || role !== 'reader')
    ) {
      throw new ApiError('forbidden')
    }
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
    if (previousRole === 'officer' && role !== 'officer') {
      const permissions = await officerPermissionsRepository.listForOfficer(
        tx,
        target.id,
      )
      for (const row of permissions) {
        const code = row.permission_code as OfficerPermissionCode
        await officerPermissionsRepository.delete(tx, target.id, code)
        await writeAudit(tx, {
          category: 'officer_permissions',
          action: 'officer_permission_disabled',
          summary: `Сброшено право «${OFFICER_PERMISSION_LABELS[code]}» после смены роли для ${target.game_nickname}`,
          actor: auditPerson(manager),
          target: {
            kind: 'officer',
            id: target.id,
            user: {
              id: target.id,
              role: 'officer',
              nickname: target.game_nickname,
              email: null,
            },
          },
          details: { permission_code: code, enabled: false },
        })
      }
    }
    return applyRole(
      tx,
      deps,
      manager,
      target,
      role,
      role === 'reader'
        ? ROLE_AUDIT.blocked
        : previousRole === 'reader' && role === 'member'
          ? ROLE_AUDIT.restored
          : ROLE_AUDIT.changed,
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
  await requireOfficerPermission(deps, keeper, 'roster.reader_roles')
  const { userId } = parseBody(restoreReaderSchema, body)

  return withTransaction(deps.db, async (tx) => {
    const target = await profileRepository.findByIdForUpdate(tx, userId)
    if (!target) {
      throw new ApiError('not_found')
    }
    // Удаляемый аккаунт не меняет роль: удаление не обходит запрет Q-73.
    if (await userRepository.deletionPending(tx, userId)) {
      throw new ApiError('state_conflict')
    }
    if (target.access_role !== 'reader') {
      throw new ApiError('state_conflict')
    }
    return applyRole(tx, deps, keeper, target, 'member', ROLE_AUDIT.restored)
  })
}
