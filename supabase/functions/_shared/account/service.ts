import type { AppDeps } from '../app.ts'
import {
  requireConfirmedUser,
  requireProfile,
  requireUser,
  type Actor,
  type UserActor,
} from '../auth/actor.ts'
import { writeAudit, type AuditPerson } from '../audit/service.ts'
import { catalogRepository } from '../catalog/repository.ts'
import {
  avatarUploadSchema,
  checkNicknameSchema,
  completeRegistrationSchema,
  updateProfileSchema,
  type AccessRole,
  type ApplicationStatus,
  type AvatarUploadResponse,
  type CheckNicknameResponse,
  type MeResponse,
} from '../contracts/account.ts'
import { withTransaction, type Executor } from '../db/client.ts'
import { isUniqueViolation } from '../db/errors.ts'
import type { ProfileRow } from '../db/schema.ts'
import { ApiError } from '../http/errors.ts'
import { parseBody } from '../http/validation.ts'
import {
  AVATAR_BUCKET,
  avatarUrl,
  cleanupAvatarFolder,
  newAvatarPath,
  verifyAvatar,
} from './avatars.ts'
import {
  applicationRepository,
  NICKNAME_CONSTRAINT,
  PROFILE_PK_CONSTRAINT,
  profileRepository,
} from './repository.ts'

/** Роли, которым показывается статус своей заявки (матрица ACL, ACC-05). */
const APPLICATION_VISIBLE_TO = ['applicant', 'member', 'officer', 'admin']

const nicknameTaken = () =>
  new ApiError('validation_failed', { gameNickname: 'nickname_taken' })

function person(user: UserActor, profile: ProfileRow): AuditPerson {
  return {
    id: user.userId,
    role: profile.access_role as AccessRole,
    nickname: profile.game_nickname,
    email: user.email,
  }
}

async function ensureActiveClass(db: Executor, classId: number) {
  if (!(await catalogRepository.isActiveClass(db, classId))) {
    throw new ApiError('validation_failed', { classId: 'required' })
  }
}

export async function checkNickname(
  deps: AppDeps,
  body: unknown,
): Promise<CheckNicknameResponse> {
  const { gameNickname } = parseBody(checkNicknameSchema, body)
  return {
    available: !(await profileRepository.nicknameTaken(deps.db, gameNickname)),
  }
}

async function buildMe(deps: AppDeps, user: UserActor): Promise<MeResponse> {
  const profile = await profileRepository.findById(deps.db, user.userId)
  if (!profile) return { state: 'incomplete', email: user.email }
  const [className, url, application] = await Promise.all([
    profileRepository.className(deps.db, profile.class_id),
    avatarUrl(deps.storage, profile.avatar_path),
    APPLICATION_VISIBLE_TO.includes(profile.access_role)
      ? applicationRepository.latestForApplicant(deps.db, profile.id)
      : Promise.resolve(undefined),
  ])
  return {
    state: 'ready',
    email: user.email,
    profile: {
      id: profile.id,
      displayName: profile.display_name,
      gameNickname: profile.game_nickname,
      city: profile.city,
      birthDate: profile.birth_date,
      classId: profile.class_id,
      className,
      about: profile.about,
      avatarUrl: url,
      role: profile.access_role as AccessRole,
      joinedOn: profile.joined_on,
      createdAt: profile.created_at,
    },
    application: application
      ? {
          id: application.id,
          status: application.status as ApplicationStatus,
          submittedAt: application.submitted_at,
        }
      : null,
  }
}

export async function getMe(deps: AppDeps, actor: Actor) {
  return buildMe(deps, requireConfirmedUser(requireUser(actor)))
}

export async function createAvatarUpload(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<AvatarUploadResponse> {
  const user = requireConfirmedUser(actor)
  const { contentType } = parseBody(avatarUploadSchema, body)
  const upload = await deps.storage.createUploadUrl(
    AVATAR_BUCKET,
    newAvatarPath(user.userId, contentType),
  )
  return { bucket: AVATAR_BUCKET, ...upload }
}

/**
 * Завершение регистрации (Q-28, Q-29): профиль кандидата, заявка, ссылки и одно
 * событие аудита в одной транзакции. Повторный вызов возвращает текущее состояние.
 */
export async function completeRegistration(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<MeResponse> {
  const user = requireConfirmedUser(actor)
  if (user.profile) return buildMe(deps, user)
  const input = parseBody(completeRegistrationSchema, body)
  await ensureActiveClass(deps.db, input.classId)
  if (await profileRepository.nicknameTaken(deps.db, input.gameNickname)) {
    throw nicknameTaken()
  }
  await verifyAvatar(deps.storage, user.userId, input.avatarPath)

  try {
    await withTransaction(deps.db, async (tx) => {
      const row = {
        id: user.userId,
        display_name: input.displayName,
        game_nickname: input.gameNickname,
        city: input.city,
        birth_date: input.birthDate,
        class_id: input.classId,
        about: input.about,
        avatar_path: input.avatarPath,
        access_role: 'applicant' as const,
      }
      await profileRepository.insert(tx, row)
      const applicationId = await applicationRepository.create(
        tx,
        user.userId,
        input.equipmentLinks,
      )
      const actorPerson = {
        id: user.userId,
        role: row.access_role,
        nickname: row.game_nickname,
        email: user.email,
      }
      await writeAudit(tx, {
        category: 'applications',
        action: 'registration_completed',
        summary: 'Регистрация и создание заявки',
        actor: actorPerson,
        target: {
          kind: 'join_application',
          id: applicationId,
          user: actorPerson,
        },
        details: { profile_id: user.userId, application_id: applicationId },
      })
    })
  } catch (error) {
    if (isUniqueViolation(error, NICKNAME_CONSTRAINT)) throw nicknameTaken()
    // Параллельная вкладка уже завершила регистрацию — отдаём её результат.
    if (!isUniqueViolation(error, PROFILE_PK_CONSTRAINT)) throw error
  }
  const saved = await profileRepository.findById(deps.db, user.userId)
  if (saved)
    await cleanupAvatarFolder(deps.storage, user.userId, saved.avatar_path)
  return buildMe(deps, user)
}

const FIELD_COLUMNS = {
  displayName: 'display_name',
  gameNickname: 'game_nickname',
  city: 'city',
  birthDate: 'birth_date',
  classId: 'class_id',
  about: 'about',
} as const

/** Изменение своего профиля (ACC-06/07, Q-31, Q-34). Роль, дата вступления и email не меняются. */
export async function updateProfile(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<MeResponse> {
  const user = requireProfile(actor)
  const input = parseBody(updateProfileSchema, body)
  const current = user.profile
  await ensureActiveClass(deps.db, input.classId)
  if (
    input.gameNickname !== current.game_nickname &&
    (await profileRepository.nicknameTaken(
      deps.db,
      input.gameNickname,
      user.userId,
    ))
  ) {
    throw nicknameTaken()
  }

  const changes: Record<string, unknown> = {}
  const changedFields: string[] = []
  for (const [field, column] of Object.entries(FIELD_COLUMNS)) {
    const next = input[field as keyof typeof FIELD_COLUMNS]
    if (next !== current[column]) {
      changes[column] = next
      changedFields.push(column)
    }
  }
  let nextAvatar = current.avatar_path
  if (input.avatar.action === 'replace') {
    await verifyAvatar(deps.storage, user.userId, input.avatar.path)
    nextAvatar = input.avatar.path
  } else if (input.avatar.action === 'remove') {
    nextAvatar = null
  }
  if (nextAvatar !== current.avatar_path) {
    changes.avatar_path = nextAvatar
    changedFields.push('avatar_path')
  }
  if (changedFields.length === 0) return buildMe(deps, user)

  try {
    await withTransaction(deps.db, async (tx) => {
      await profileRepository.update(tx, user.userId, {
        ...changes,
        updated_at: deps.now().toISOString(),
      })
      const after = { ...current, ...changes } as ProfileRow
      await writeAudit(tx, {
        category: 'profiles',
        action: 'profile_updated',
        summary: 'Изменение профиля',
        actor: person(user, after),
        target: { kind: 'profile', id: user.userId, user: person(user, after) },
        details: { changed_fields: changedFields },
      })
    })
  } catch (error) {
    if (isUniqueViolation(error, NICKNAME_CONSTRAINT)) throw nicknameTaken()
    throw error
  }
  if (changedFields.includes('avatar_path')) {
    await cleanupAvatarFolder(deps.storage, user.userId, nextAvatar)
  }
  return buildMe(deps, user)
}
