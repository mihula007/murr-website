import { avatarUrls } from '../account/avatars.ts'
import type { AppDeps } from '../app.ts'
import { requireRole, type Actor } from '../auth/actor.ts'
import type { AccessRole } from '../contracts/account.ts'
import {
  readersListSchema,
  rosterListSchema,
  type RosterCountResponse,
  type RosterListResponse,
  type RosterMember,
  type RosterReadersResponse,
  type RosterStatsResponse,
} from '../contracts/roster.ts'
import { decodeCursor, splitPage } from '../http/cursor.ts'
import { parseBody } from '../http/validation.ts'
import { INTERNAL_ROLES } from '../membership.ts'
import { nicknameCursor, nicknameKey } from './cursor.ts'
import { rosterRepository } from './repository.ts'

/** Восстанавливают чтеца офицер и администратор (ACL-06, ADM-09). */
const READER_KEEPERS = ['officer', 'admin'] as const

type CardRow = Awaited<ReturnType<typeof rosterRepository.listByRoles>>[number]

async function toCards(
  deps: AppDeps,
  rows: CardRow[],
): Promise<RosterMember[]> {
  const urls = await avatarUrls(
    deps.storage,
    rows.map((row) => row.avatar_path),
  )
  return rows.map((row) => ({
    id: row.id,
    gameNickname: row.game_nickname,
    classId: row.class_id,
    className: row.class_name,
    avatarUrl: row.avatar_path ? (urls.get(row.avatar_path) ?? null) : null,
    role: row.access_role as AccessRole,
  }))
}

/** Численность на главной видна всем, включая гостя; без списка участников. */
export async function countRoster(deps: AppDeps): Promise<RosterCountResponse> {
  return { count: await rosterRepository.countByRoles(deps.db, INTERNAL_ROLES) }
}

/** Численность и распределение по классам для внутренних ролей (ROS-05). */
export async function rosterStats(
  deps: AppDeps,
  actor: Actor,
): Promise<RosterStatsResponse> {
  requireRole(actor, INTERNAL_ROLES)
  const [total, classes] = await Promise.all([
    rosterRepository.countByRoles(deps.db, INTERNAL_ROLES),
    rosterRepository.classStats(deps.db, INTERNAL_ROLES),
  ])
  return { total, classes }
}

async function cardPage(
  deps: AppDeps,
  roles: readonly string[],
  classId: number | null,
  cursor: string | null,
  limit: number,
) {
  const rows = await rosterRepository.listByRoles(deps.db, {
    roles,
    classId,
    after: cursor ? decodeCursor(nicknameCursor, cursor) : null,
    limit: limit + 1,
  })
  const page = splitPage(rows, limit, (row) =>
    nicknameKey(row.game_nickname, row.id),
  )
  return { items: await toCards(deps, page.rows), nextCursor: page.nextCursor }
}

/** Страница текущего состава для внутренних ролей (ROS-01–03, ACL-09). */
export async function listRoster(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<RosterListResponse> {
  requireRole(actor, INTERNAL_ROLES)
  const { classId, cursor, limit } = parseBody(rosterListSchema, body ?? {})
  return cardPage(deps, INTERNAL_ROLES, classId, cursor, limit)
}

/** Страница чтецов для офицера и администратора (ACL-06, ADM-09). */
export async function listReaders(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<RosterReadersResponse> {
  requireRole(actor, READER_KEEPERS)
  const { cursor, limit } = parseBody(readersListSchema, body ?? {})
  return cardPage(deps, ['reader'], null, cursor, limit)
}
