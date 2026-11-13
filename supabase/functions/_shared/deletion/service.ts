import { profileRepository } from '../account/repository.ts'
import { AVATAR_BUCKET } from '../account/avatars.ts'
import { accountRepository } from '../accounts/repository.ts'
import type { AppDeps } from '../app.ts'
import { auditPerson, writeAudit } from '../audit/service.ts'
import { requireRole, type Actor, type ProfiledActor } from '../auth/actor.ts'
import { userRepository } from '../auth/repository.ts'
import type { AccessRole } from '../contracts/account.ts'
import {
  deleteAccountSchema,
  type DeleteAccountResult,
  type DeletionStage,
  type PendingDeletionsResponse,
} from '../contracts/accounts.ts'
import { SMALL_LIST_LIMIT } from '../contracts/paging.ts'
import { withTransaction } from '../db/client.ts'
import { ApiError } from '../http/errors.ts'
import { parseBody } from '../http/validation.ts'
import { PUBLICATION_BUCKET, uploadFolder } from '../publications/files.ts'
import type { StorageGateway } from '../storage/gateway.ts'
import { deletionRepository } from './repository.ts'

/** Папка Storage не пустеет за столько проходов — этап считается сбоем. */
const MAX_FOLDER_PASSES = 20

/** Удаляет все файлы папки (список отдаёт до 100 за раз) и проверяет пустоту. */
async function emptyFolder(
  storage: StorageGateway,
  bucket: string,
  folder: string,
) {
  for (let pass = 0; pass < MAX_FOLDER_PASSES; pass += 1) {
    const paths = await storage.list(bucket, folder)
    if (paths.length === 0) {
      return
    }
    await storage.remove(bucket, paths)
  }
  throw new Error(`Папка ${bucket} не очищена`)
}

/** Первый запрос: проверки и служебная запись (Q-73). Повтор — та же запись. */
async function startDeletion(
  deps: AppDeps,
  admin: ProfiledActor,
  userId: string,
  confirmNickname: string,
) {
  return withTransaction(deps.db, async (tx) => {
    // Порядок блокировок как у смены роли: администраторы, затем цель.
    await accountRepository.lockAdmins(tx)
    const existing = await deletionRepository.lock(tx, userId)
    if (existing) {
      if (existing.nickname !== confirmNickname) {
        throw new ApiError('validation_failed', {
          confirmNickname: 'nickname_mismatch',
        })
      }
      return existing.stage as DeletionStage
    }
    const target = await profileRepository.findByIdForUpdate(tx, userId)
    if (!target) {
      throw new ApiError('not_found')
    }
    // Администратора сначала понижают обычной сменой роли (Q-73).
    if (target.access_role === 'admin') {
      throw new ApiError('forbidden')
    }
    if (target.game_nickname !== confirmNickname) {
      throw new ApiError('validation_failed', {
        confirmNickname: 'nickname_mismatch',
      })
    }
    const user = await userRepository.findById(tx, userId)
    await deletionRepository.create(tx, {
      userId,
      requestedBy: admin.userId,
      nickname: target.game_nickname,
      email: user?.email ?? '',
    })
    return 'files' as const
  })
}

/** Этап 1: личные файлы через Storage API до транзакции БД. */
async function deleteFiles(deps: AppDeps, userId: string) {
  await emptyFolder(deps.storage, AVATAR_BUCKET, userId)
  await emptyFolder(deps.storage, PUBLICATION_BUCKET, uploadFolder(userId))
  await withTransaction(deps.db, async (tx) => {
    const record = await deletionRepository.lock(tx, userId)
    if (record?.stage === 'files') {
      await deletionRepository.setStage(tx, userId, 'database')
    }
  })
}

/**
 * Этап 2 — одна транзакция прикладной БД: черновики, профиль (каскады и
 * `SET NULL` схемы) и одна запись аудита с ником и email (ADM-11).
 */
async function deleteData(deps: AppDeps, admin: ProfiledActor, userId: string) {
  await withTransaction(deps.db, async (tx) => {
    await accountRepository.lockAdmins(tx)
    const record = await deletionRepository.lock(tx, userId)
    if (record?.stage !== 'database') {
      return
    }
    const target = await profileRepository.findByIdForUpdate(tx, userId)
    if (target?.access_role === 'admin') {
      throw new ApiError('state_conflict')
    }
    const cleanupPaths = await deletionRepository.deleteDrafts(tx, userId)
    await deletionRepository.deleteProfile(tx, userId)
    await writeAudit(tx, {
      category: 'participants',
      action: 'user_deleted',
      summary: 'Безвозвратное удаление пользователя',
      actor: auditPerson(admin),
      target: {
        kind: 'profile',
        id: userId,
        // Связь с профилем не сохраняется: только снимок ника и email.
        user: {
          id: null,
          role: (target?.access_role ?? null) as AccessRole | null,
          nickname: record.nickname,
          email: record.email,
        },
      },
      details: { user_id: userId },
    })
    await deletionRepository.setStage(tx, userId, 'auth', cleanupPaths)
  })
}

/** Этап 3: файлы удалённых черновиков и пользователь Auth; запись стирается. */
async function deleteAuth(deps: AppDeps, userId: string) {
  const record = await deletionRepository.find(deps.db, userId)
  if (record?.stage !== 'auth') {
    return
  }
  await deps.storage.remove(PUBLICATION_BUCKET, record.cleanup_paths)
  const result = await deps.authAdmin.deleteUser(userId)
  // 404 — успех только если пользователя действительно нет.
  if (
    result === 'not_found' &&
    (await userRepository.findById(deps.db, userId))
  ) {
    throw new Error('Пользователь Auth не удалён')
  }
  await deletionRepository.remove(deps.db, userId)
}

/**
 * Безвозвратное удаление пользователя (ADM-08, Q-73–Q-75): начинает новое
 * или продолжает прерванное. Каждый этап отмечается в служебной записи;
 * сбой оставляет её с кодом ошибки, доступ аккаунта закрыт (`account_deleted`).
 */
export async function deleteAccount(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<DeleteAccountResult> {
  const admin = requireRole(actor, ['admin'])
  const { userId, confirmNickname } = parseBody(deleteAccountSchema, body)
  if (userId === admin.userId) {
    throw new ApiError('forbidden')
  }
  let stage = await startDeletion(deps, admin, userId, confirmNickname)
  const steps: [DeletionStage, () => Promise<void>][] = [
    ['files', () => deleteFiles(deps, userId)],
    ['database', () => deleteData(deps, admin, userId)],
    ['auth', () => deleteAuth(deps, userId)],
  ]
  const start = steps.findIndex(([name]) => name === stage)
  for (const [name, run] of steps.slice(start)) {
    stage = name
    try {
      await run()
    } catch (error) {
      if (error instanceof ApiError && error.code !== 'internal') {
        throw error
      }
      console.error(`Удаление пользователя: этап ${name} не выполнен`)
      await deletionRepository
        .setError(deps.db, userId, `${name}_failed`)
        .catch(() => undefined)
      throw new ApiError('deletion_incomplete', { stage: name })
    }
  }
  return { userId }
}

/** Незавершённые удаления для повтора (малый список). */
export async function pendingDeletions(
  deps: AppDeps,
  actor: Actor,
): Promise<PendingDeletionsResponse> {
  requireRole(actor, ['admin'])
  const rows = await deletionRepository.pending(deps.db, SMALL_LIST_LIMIT + 1)
  return {
    truncated: rows.length > SMALL_LIST_LIMIT,
    items: rows.slice(0, SMALL_LIST_LIMIT).map((row) => ({
      userId: row.user_id,
      nickname: row.nickname,
      email: row.email,
      stage: row.stage as DeletionStage,
      lastError: row.last_error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  }
}
