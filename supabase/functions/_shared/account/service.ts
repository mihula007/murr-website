import type { AppDeps } from '../app.ts'
import {
  requireConfirmedUser,
  requireProfile,
  requireUser,
  type Actor,
  type UserActor,
} from '../auth/actor.ts'
import { writeAudit, type AuditPerson } from '../audit/service.ts'
import { userRepository } from '../auth/repository.ts'
import { catalogRepository } from '../catalog/repository.ts'
import {
  avatarUploadSchema,
  checkNicknameSchema,
  completeRegistrationSchema,
  displayNameSchema,
  gameNicknameSchema,
  updateProfileSchema,
  type AccessRole,
  type ApplicationStatus,
  type AvatarUploadResponse,
  type CheckNicknameResponse,
  type MeResponse,
} from '../contracts/account.ts'
import { withTransaction, type Db, type Executor } from '../db/client.ts'
import { isUniqueViolation } from '../db/errors.ts'
import type { ProfileRow } from '../db/schema.ts'
import { ApiError } from '../http/errors.ts'
import { moscowDate } from '../membership.ts'
import { parseBody } from '../http/validation.ts'
import {
  AVATAR_BUCKET,
  avatarUrl,
  cleanupAvatarFolder,
  newAvatarPath,
  verifyAvatar,
} from './avatars.ts'
import {
  ACTIVE_STATUSES,
  applicationRepository,
} from '../applications/repository.ts'
import {
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

/** Ответ `account/me` для пользователя; используют и другие операции. */
export async function buildMe(
  deps: AppDeps,
  user: UserActor,
): Promise<MeResponse> {
  const profile = await profileRepository.findById(deps.db, user.userId)
  if (!profile) {
    return { state: 'incomplete', email: user.email }
  }
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
    canResubmit:
      profile.access_role === 'applicant' &&
      !(
        application &&
        (ACTIVE_STATUSES as readonly string[]).includes(application.status)
      ),
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
  if (user.profile) {
    return buildMe(deps, user)
  }
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
    if (isUniqueViolation(error, NICKNAME_CONSTRAINT)) {
      throw nicknameTaken()
    }
    // Параллельная вкладка уже завершила регистрацию — отдаём её результат.
    if (!isUniqueViolation(error, PROFILE_PK_CONSTRAINT)) {
      throw error
    }
  }
  const saved = await profileRepository.findById(deps.db, user.userId)
  if (saved) {
    await cleanupAvatarFolder(deps.storage, user.userId, saved.avatar_path)
  }
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
  if (changedFields.length === 0) {
    return buildMe(deps, user)
  }

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
    if (isUniqueViolation(error, NICKNAME_CONSTRAINT)) {
      throw nicknameTaken()
    }
    throw error
  }
  if (changedFields.includes('avatar_path')) {
    await cleanupAvatarFolder(deps.storage, user.userId, nextAvatar)
  }
  return buildMe(deps, user)
}

export type BootstrapInput = {
  email: string
  gameNickname: string
  displayName: string
  classSlug: string
}

/**
 * Назначение первого администратора (Q-24, Q-32): однократно, только для
 * подтверждённого пользователя без профиля, без заявки и с записью аудита.
 * Вызывается закрытой командой владельца, а не публичным API.
 */
export async function bootstrapFirstAdmin(
  db: Db,
  input: BootstrapInput,
  now = new Date(),
) {
  const gameNickname = gameNicknameSchema.parse(input.gameNickname)
  const displayName = displayNameSchema.parse(input.displayName)
  const email = input.email.trim().toLowerCase()

  try {
    return await withTransaction(db, async (tx) => {
      if (await profileRepository.adminExists(tx)) {
        throw new ApiError('already_bootstrapped')
      }
      const user = await userRepository.findByEmail(tx, email)
      if (!user) {
        throw new ApiError('not_found')
      }
      if (!user.email_confirmed_at) {
        throw new ApiError('email_not_confirmed')
      }
      if (await profileRepository.findById(tx, user.id)) {
        throw new ApiError('validation_failed', { email: 'profile_exists' })
      }
      const classId = await catalogRepository.findIdBySlug(tx, input.classSlug)
      if (classId === undefined) {
        throw new ApiError('validation_failed', { classSlug: 'required' })
      }
      if (await profileRepository.nicknameTaken(tx, gameNickname)) {
        throw new ApiError('validation_failed', {
          gameNickname: 'nickname_taken',
        })
      }

      await profileRepository.insert(tx, {
        id: user.id,
        display_name: displayName,
        game_nickname: gameNickname,
        class_id: classId,
        access_role: 'admin',
        is_primary_admin: true,
        joined_on: moscowDate(now),
      })
      const admin = {
        id: user.id,
        role: 'admin' as const,
        nickname: gameNickname,
        email,
      }
      await writeAudit(tx, {
        category: 'participants',
        action: 'first_admin_bootstrapped',
        summary: 'Назначен первый администратор',
        actor: admin,
        target: { kind: 'profile', id: user.id, user: admin },
        details: { profile_id: user.id, role: 'admin' },
      })
      return { userId: user.id }
    })
  } catch (error) {
    // Параллельный запуск: основной администратор уже записан другой командой.
    if (isUniqueViolation(error, 'profiles_single_primary_admin')) {
      throw new ApiError('already_bootstrapped')
    }
    throw error
  }
}
