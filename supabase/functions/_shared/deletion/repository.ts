import { sql } from 'kysely'
import type { DeletionStage } from '../contracts/accounts.ts'
import type { Executor } from '../db/client.ts'

export const deletionRepository = {
  find(db: Executor, userId: string) {
    return db
      .selectFrom('app.user_deletions')
      .selectAll()
      .where('user_id', '=', userId)
      .executeTakeFirst()
  },

  /** Запись с блокировкой: этапы одного удаления не выполняются дважды. */
  lock(tx: Executor, userId: string) {
    return tx
      .selectFrom('app.user_deletions')
      .selectAll()
      .where('user_id', '=', userId)
      .forUpdate()
      .executeTakeFirst()
  },

  async create(
    tx: Executor,
    value: {
      userId: string
      requestedBy: string
      nickname: string
      email: string
    },
  ) {
    await tx
      .insertInto('app.user_deletions')
      .values({
        user_id: value.userId,
        requested_by: value.requestedBy,
        nickname: value.nickname,
        email: value.email,
        stage: 'files',
      })
      .onConflict((oc) => oc.column('user_id').doNothing())
      .execute()
  },

  async setStage(
    tx: Executor,
    userId: string,
    stage: DeletionStage,
    cleanupPaths?: string[],
  ) {
    await tx
      .updateTable('app.user_deletions')
      .set({
        stage,
        last_error: null,
        updated_at: sql<string>`now()`,
        ...(cleanupPaths ? { cleanup_paths: cleanupPaths } : {}),
      })
      .where('user_id', '=', userId)
      .execute()
  },

  async setError(db: Executor, userId: string, code: string) {
    await db
      .updateTable('app.user_deletions')
      .set({ last_error: code, updated_at: sql<string>`now()` })
      .where('user_id', '=', userId)
      .execute()
  },

  /** Стирает запись после удаления Auth (Q-75). */
  async remove(db: Executor, userId: string) {
    await db
      .deleteFrom('app.user_deletions')
      .where('user_id', '=', userId)
      .execute()
  },

  pending(db: Executor, limit: number) {
    return db
      .selectFrom('app.user_deletions')
      .selectAll()
      .orderBy('created_at')
      .orderBy('user_id')
      .limit(limit)
      .execute()
  },

  /**
   * Удаляет черновики публикаций и объявлений автора и возвращает пути их
   * вложений: иначе `CHECK` автора не даст удалить профиль (PUB-17, MKT-12).
   */
  async deleteDrafts(tx: Executor, userId: string) {
    const attachments = await tx
      .selectFrom('app.publication_attachments as a')
      .innerJoin('app.publications as p', 'p.id', 'a.publication_id')
      .select('a.path')
      .where('p.author_id', '=', userId)
      .where('p.status', '=', 'draft')
      .execute()
    await tx
      .deleteFrom('app.publications')
      .where('author_id', '=', userId)
      .where('status', '=', 'draft')
      .execute()
    await tx
      .deleteFrom('app.market_listings')
      .where('author_id', '=', userId)
      .where('status', '=', 'draft')
      .execute()
    return attachments.map((row) => row.path)
  },

  /**
   * Удаляет профиль: остальное делают `ON DELETE` схемы (таблица данных
   * плана этапа 11): каскад личных записей, `SET NULL` у сохраняемых.
   */
  async deleteProfile(tx: Executor, userId: string) {
    await tx.deleteFrom('app.profiles').where('id', '=', userId).execute()
  },
}
