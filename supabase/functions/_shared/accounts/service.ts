import { z } from 'zod'
import { avatarUrl } from '../account/avatars.ts'
import { profileRepository, type ProfileUpdate } from '../account/repository.ts'
import type { AppDeps } from '../app.ts'
import { applicationRepository } from '../applications/repository.ts'
import { auditPerson, writeAudit } from '../audit/service.ts'
import { requireRole, type Actor, type ProfiledActor } from '../auth/actor.ts'
import { userRepository } from '../auth/repository.ts'
import type { AccessRole, ApplicationStatus } from '../contracts/account.ts'
import {
  accountIdSchema,
  accountsListSchema,
  restoreReaderSchema,
  setPasswordSchema,
  setRoleSchema,
  type AccountCard,
  type AccountListItem,
  type AccountsListResponse,
  type RoleChangeResult,
  type SetPasswordResult,
} from '../contracts/accounts.ts'
import {
  CHARACTER_STAT_LABELS,
  setCharacterStatSchema,
  type SetCharacterStatCommand,
  type SetCharacterStatResult,
} from '../contracts/character-stats.ts'
import { withTransaction, type Executor } from '../db/client.ts'
import type { ProfileRow } from '../db/schema.ts'
import { decodeCursor, splitPage } from '../http/cursor.ts'
import { ApiError } from '../http/errors.ts'
import { parseBody } from '../http/validation.ts'
import { joinedOnAfterRoleChange, moscowDate } from '../membership.ts'
import { notify } from '../notifications/service.ts'
import { accountRepository, type AccountKey } from './repository.ts'

/** Восстанавливают чтеца офицер и администратор (ACL-06, ADM-09). */
const READER_KEEPERS = ['officer', 'admin'] as const

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
    accountRepository.count(deps.db, input.search),
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

function characterStatUpdate(
  command: SetCharacterStatCommand,
  updatedAt: string,
): ProfileUpdate {
  if (command.field === 'source') {
    return {
      character_stats_source: command.value,
      updated_at: updatedAt,
    }
  }
  switch (command.field) {
    case 'pa':
      return { pa: command.value, updated_at: updatedAt }
    case 'pz':
      return { pz: command.value, updated_at: updatedAt }
    case 'bu':
      return { bu: command.value, updated_at: updatedAt }
    case 'hp':
      return { hp: command.value, updated_at: updatedAt }
    case 'bd':
      return { bd: command.value, updated_at: updatedAt }
  }
}

function sameCharacterStat(
  command: SetCharacterStatCommand,
  target: ProfileRow,
) {
  if (command.field === 'source') {
    return target.character_stats_source === command.value
  }
  const previous = target[command.field]
  return previous === null
    ? command.value === null
    : command.value !== null && Number(previous) === command.value
}

/** Одно поле характеристик аккаунта (ADM-15): только администратор. */
export async function setCharacterStat(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<SetCharacterStatResult> {
  const admin = requireRole(actor, ['admin'])
  const command = parseBody(setCharacterStatSchema, body)

  return withTransaction(deps.db, async (tx) => {
    const target = await profileRepository.findByIdForUpdate(tx, command.userId)
    if (!target) {
      throw new ApiError('not_found')
    }
    if (await userRepository.deletionPending(tx, command.userId)) {
      throw new ApiError('state_conflict')
    }

    if (!sameCharacterStat(command, target)) {
      await profileRepository.update(
        tx,
        command.userId,
        characterStatUpdate(command, deps.now().toISOString()),
      )
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
          changed_fields: [CHARACTER_STAT_LABELS[command.field]],
        },
      })
    }

    return {
      userId: command.userId,
      field: command.field,
      value: command.value,
    }
  })
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
    // Удаляемый аккаунт не меняет роль: удаление не обходит запрет Q-73.
    if (await userRepository.deletionPending(tx, userId)) {
      throw new ApiError('state_conflict')
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
