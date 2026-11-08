import { writeAudit } from '../audit/service.ts'
import { displayNameSchema, gameNicknameSchema } from '../contracts/account.ts'
import { withTransaction, type Db } from '../db/client.ts'
import { isUniqueViolation } from '../db/errors.ts'
import { ApiError } from '../http/errors.ts'
import { profileRepository } from './repository.ts'

export type BootstrapInput = {
  email: string
  gameNickname: string
  displayName: string
  classSlug: string
}

/** Дата по Москве (UTC+3, Q-08) для даты вступления. */
export function moscowDate(now: Date) {
  return new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10)
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
      const user = await tx
        .selectFrom('auth.users')
        .select(['id', 'email', 'email_confirmed_at'])
        .where('email', '=', email)
        .executeTakeFirst()
      if (!user) throw new ApiError('not_found')
      if (!user.email_confirmed_at) throw new ApiError('email_not_confirmed')
      if (await profileRepository.findById(tx, user.id)) {
        throw new ApiError('validation_failed', { email: 'profile_exists' })
      }
      const klass = await tx
        .selectFrom('app.character_classes')
        .select('id')
        .where('slug', '=', input.classSlug)
        .executeTakeFirst()
      if (!klass)
        throw new ApiError('validation_failed', { classSlug: 'required' })
      if (await profileRepository.nicknameTaken(tx, gameNickname)) {
        throw new ApiError('validation_failed', {
          gameNickname: 'nickname_taken',
        })
      }

      await profileRepository.insert(tx, {
        id: user.id,
        display_name: displayName,
        game_nickname: gameNickname,
        class_id: klass.id,
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
