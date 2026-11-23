import { z } from 'zod'
import { avatarUrl } from '../account/avatars.ts'
import type { AppDeps } from '../app.ts'
import { requireRole, type Actor } from '../auth/actor.ts'
import type { AccessRole } from '../contracts/account.ts'
import type { CharacterStatNumberField } from '../contracts/character-stats.ts'
import {
  dynamicsAttendanceSchema,
  dynamicsProfileSchema,
  dynamicsStatsSchema,
} from '../contracts/roster-dynamics.ts'
import { INTERNAL_ROLES, isInternalRole } from '../membership.ts'
import { characterStatHistoryRepository } from '../character-stats/repository.ts'
import { withTransaction } from '../db/client.ts'
import { isValidCronSecret } from '../http/cron-secret.ts'
import { decodeCursor, splitPage } from '../http/cursor.ts'
import { ApiError } from '../http/errors.ts'
import { parseBody } from '../http/validation.ts'
import { rosterDynamicsRepository } from './repository.ts'

const statCursor = z.tuple([z.string().max(50), z.guid()])
const weekCursor = z.tuple([z.iso.date()])
const profile = (deps: AppDeps, userId: string) =>
  rosterDynamicsRepository.profile(deps.db, userId)

function cutoffFor(period: '30' | '90' | '365' | 'all', now: Date) {
  if (period === 'all') {
    return null
  }
  const date = new Date(now.getTime() + 3 * 60 * 60 * 1000)
  date.setUTCDate(date.getUTCDate() - Number(period))
  return date.toISOString().slice(0, 10)
}

async function targetOrNotFound(deps: AppDeps, userId: string) {
  const row = await profile(deps, userId)
  if (
    !row ||
    row.deletion_pending ||
    !isInternalRole(row.access_role as AccessRole)
  ) {
    throw new ApiError('not_found')
  }
  return row
}

export async function dynamicsProfile(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
) {
  requireRole(actor, INTERNAL_ROLES)
  const input = parseBody(dynamicsProfileSchema, body)
  const row = await targetOrNotFound(deps, input.userId)
  return {
    id: row.id,
    gameNickname: row.game_nickname,
    className: row.class_name,
    avatarUrl: await avatarUrl(deps.storage, row.avatar_path),
    displayName: row.display_name,
    joinedOn: row.joined_on,
  }
}

export async function dynamicsStats(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
) {
  requireRole(actor, INTERNAL_ROLES)
  const input = parseBody(dynamicsStatsSchema, body)
  await targetOrNotFound(deps, input.userId)
  const after = input.cursor ? decodeCursor(statCursor, input.cursor) : null
  const rows = await characterStatHistoryRepository.listByUser(
    deps.db,
    input.userId,
    input.fields as CharacterStatNumberField[],
    cutoffFor(input.period, deps.now()),
    after ? { recordedAt: after[0], id: after[1] } : null,
    input.limit + 1,
  )
  const page = splitPage(rows, input.limit, (row) => [row.recorded_at, row.id])
  return {
    nextCursor: page.nextCursor,
    items: page.rows.map((row) => ({
      id: row.id,
      field: row.field as CharacterStatNumberField,
      value: row.value === null ? null : Number(row.value),
      recordedAt: row.recorded_at,
      kind: row.kind as 'baseline' | 'checkpoint',
    })),
  }
}

/** Записывает по пятницам неизменяемый снимок всех показателей текущего состава. */
export async function recordWeeklyDynamicsCheckpoint(
  deps: AppDeps,
  cronSecret: string | null,
) {
  if (!isValidCronSecret(cronSecret, deps.cronSecret)) {
    throw new ApiError('forbidden')
  }
  const moscowNow = new Date(deps.now().getTime() + 3 * 60 * 60 * 1000)
  if (moscowNow.getUTCDay() !== 5) {
    throw new ApiError('forbidden')
  }
  const checkpointDate = moscowNow.toISOString().slice(0, 10)
  const recordedAt = `${checkpointDate}T20:59:00.000Z`
  return withTransaction(deps.db, async (tx) => {
    const profiles =
      await rosterDynamicsRepository.currentStatsForCheckpoint(tx)
    const rows = profiles.flatMap((profile) =>
      (['pa', 'pz', 'bu', 'hp', 'bd'] as const).map((field) => ({
        user_id: profile.id,
        field,
        value: profile[field] === null ? null : Number(profile[field]),
        recorded_at: recordedAt,
        kind: 'checkpoint' as const,
      })),
    )
    const inserted = await characterStatHistoryRepository.insertCheckpoints(
      tx,
      rows,
    )
    return {
      recordedAt,
      members: profiles.length,
      inserted: inserted.length,
    }
  })
}

export async function dynamicsAttendance(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
) {
  requireRole(actor, INTERNAL_ROLES)
  const input = parseBody(dynamicsAttendanceSchema, body)
  await targetOrNotFound(deps, input.userId)
  const after = input.cursor ? decodeCursor(weekCursor, input.cursor) : null
  const rows = await rosterDynamicsRepository.attendance(
    deps.db,
    input.userId,
    cutoffFor(input.period, deps.now()),
    after?.[0] ?? null,
    input.limit + 1,
  )
  const page = splitPage(rows, input.limit, (row) => [row.week_start])
  return {
    nextCursor: page.nextCursor,
    items: page.rows.map((row) => ({
      weekStart: row.week_start,
      visited: Number(row.visited ?? 0),
      missed: Number(row.missed ?? 0),
      unmarked: Number(row.unmarked ?? 0),
    })),
  }
}
