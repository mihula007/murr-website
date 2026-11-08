import type { Executor } from '../db/client.ts'
import type { AccessRole, ProfileRow } from '../db/schema.ts'
import { ApiError } from '../http/errors.ts'

export type GuestActor = { kind: 'guest' }
export type UserActor = {
  kind: 'user'
  userId: string
  email: string
  emailConfirmed: boolean
  profile: ProfileRow | null
}
export type Actor = GuestActor | UserActor
export type ProfiledActor = UserActor & { profile: ProfileRow }

export const GUEST: GuestActor = { kind: 'guest' }

/** Текущее состояние пользователя читается из БД при каждом запросе. */
export async function loadActor(db: Executor, userId: string): Promise<Actor> {
  const user = await db
    .selectFrom('auth.users')
    .select(['id', 'email', 'email_confirmed_at'])
    .where('id', '=', userId)
    .executeTakeFirst()
  if (!user) return GUEST
  const profile = await db
    .selectFrom('app.profiles')
    .selectAll()
    .where('id', '=', userId)
    .executeTakeFirst()
  return {
    kind: 'user',
    userId: user.id,
    email: user.email ?? '',
    emailConfirmed: user.email_confirmed_at !== null,
    profile: profile ?? null,
  }
}

export function requireUser(actor: Actor): UserActor {
  if (actor.kind !== 'user') throw new ApiError('not_authenticated')
  return actor
}

export function requireConfirmedUser(actor: Actor): UserActor {
  const user = requireUser(actor)
  if (!user.emailConfirmed) throw new ApiError('email_not_confirmed')
  return user
}

export function requireProfile(actor: Actor): ProfiledActor {
  const user = requireConfirmedUser(actor)
  if (!user.profile) throw new ApiError('registration_incomplete')
  return user as ProfiledActor
}

export function requireRole(
  actor: Actor,
  roles: readonly AccessRole[],
): ProfiledActor {
  const user = requireProfile(actor)
  if (!roles.includes(user.profile.access_role)) throw new ApiError('forbidden')
  return user
}
