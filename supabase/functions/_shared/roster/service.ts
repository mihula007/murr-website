import { avatarUrls } from '../account/avatars.ts'
import type { AppDeps } from '../app.ts'
import { requireRole, type Actor } from '../auth/actor.ts'
import type { AccessRole } from '../contracts/account.ts'
import type {
  RosterCountResponse,
  RosterListResponse,
  RosterMember,
  RosterReadersResponse,
} from '../contracts/roster.ts'
import { INTERNAL_ROLES } from '../membership.ts'
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

/** Текущий состав для внутренних ролей (ROS-01–03, ACL-09). */
export async function listRoster(
  deps: AppDeps,
  actor: Actor,
): Promise<RosterListResponse> {
  requireRole(actor, INTERNAL_ROLES)
  const [rows, classes] = await Promise.all([
    rosterRepository.listByRoles(deps.db, INTERNAL_ROLES),
    rosterRepository.classStats(deps.db, INTERNAL_ROLES),
  ])
  return {
    members: await toCards(deps, rows),
    total: rows.length,
    classes,
  }
}

export async function listReaders(
  deps: AppDeps,
  actor: Actor,
): Promise<RosterReadersResponse> {
  requireRole(actor, READER_KEEPERS)
  const rows = await rosterRepository.listByRoles(deps.db, ['reader'])
  return { readers: await toCards(deps, rows) }
}
