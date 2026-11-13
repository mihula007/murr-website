import { profileRepository } from '../account/repository.ts'
import type { Executor } from '../db/client.ts'
import type { AccessRole, ProfileRow } from '../db/schema.ts'
import { ApiError } from '../http/errors.ts'
import { userRepository } from './repository.ts'

export type GuestActor = { kind: 'guest' }
export type UserActor = {
  kind: 'user'
  userId: string
  email: string
  emailConfirmed: boolean
  profile: ProfileRow | null
}
/**
 * Аккаунт удаляется или удалён, а сеанс ещё жив (Q-74): любой доступ закрыт,
 * в том числе «завершение регистрации» после удаления профиля.
 */
export type DeletedActor = { kind: 'deleted'; userId: string }
export type Actor = GuestActor | UserActor | DeletedActor
export type ProfiledActor = UserActor & { profile: ProfileRow }

export const GUEST: GuestActor = { kind: 'guest' }

/** Текущее состояние пользователя читается из БД при каждом запросе. */
export async function loadActor(db: Executor, userId: string): Promise<Actor> {
  const user = await userRepository.findById(db, userId)
  if (!user) {
    return GUEST
  }
  if (await userRepository.deletionPending(db, userId)) {
    return { kind: 'deleted', userId }
  }
  const profile = await profileRepository.findById(db, userId)
  return {
    kind: 'user',
    userId: user.id,
    email: user.email ?? '',
    emailConfirmed: user.email_confirmed_at !== null,
    profile: profile ?? null,
  }
}

export function requireUser(actor: Actor): UserActor {
  if (actor.kind === 'deleted') {
    throw new ApiError('account_deleted')
  }
  if (actor.kind !== 'user') {
    throw new ApiError('not_authenticated')
  }
  return actor
}

export function requireConfirmedUser(actor: Actor): UserActor {
  const user = requireUser(actor)
  if (!user.emailConfirmed) {
    throw new ApiError('email_not_confirmed')
  }
  return user
}

export function requireProfile(actor: Actor): ProfiledActor {
  const user = requireConfirmedUser(actor)
  if (!user.profile) {
    throw new ApiError('registration_incomplete')
  }
  return user as ProfiledActor
}

export function requireRole(
  actor: Actor,
  roles: readonly AccessRole[],
): ProfiledActor {
  const user = requireProfile(actor)
  if (!roles.includes(user.profile.access_role as AccessRole)) {
    throw new ApiError('forbidden')
  }
  return user
}
