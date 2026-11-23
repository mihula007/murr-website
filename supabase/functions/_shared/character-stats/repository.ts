import type { Executor } from '../db/client.ts'
import type { CharacterStatNumberField } from '../contracts/character-stats.ts'

export type CharacterStatHistoryInsert = {
  user_id: string
  field: CharacterStatNumberField
  value: number | null
  recorded_at: string
  kind: 'change'
}
export type CharacterStatCheckpointInsert = Omit<
  CharacterStatHistoryInsert,
  'kind'
> & { kind: 'checkpoint' }

/** История закрыта от браузера и доступна только серверным операциям. */
export const characterStatHistoryRepository = {
  insertMany(db: Executor, rows: CharacterStatHistoryInsert[]) {
    if (rows.length === 0) {
      return Promise.resolve()
    }
    return db.insertInto('app.character_stat_history').values(rows).execute()
  },

  insertCheckpoints(db: Executor, rows: CharacterStatCheckpointInsert[]) {
    if (rows.length === 0) {
      return Promise.resolve([])
    }
    return db
      .insertInto('app.character_stat_history')
      .values(rows)
      .onConflict((conflict) =>
        conflict
          .columns(['user_id', 'field', 'recorded_at'])
          .where('kind', '=', 'checkpoint')
          .doNothing(),
      )
      .returning('id')
      .execute()
  },

  listByUser(
    db: Executor,
    userId: string,
    fields: CharacterStatNumberField[],
    cutoff: string | null,
    after: { recordedAt: string; id: string } | null,
    limit: number,
  ) {
    let query = db
      .selectFrom('app.character_stat_history')
      .select(['id', 'field', 'value', 'recorded_at', 'kind'])
      .where('user_id', '=', userId)
      .where('field', 'in', fields)
      .where('kind', 'in', ['baseline', 'checkpoint'])
    if (cutoff) {
      query = query.where('recorded_at', '>=', cutoff)
    }
    if (after) {
      query = query.where((eb) =>
        eb.or([
          eb('recorded_at', '<', after.recordedAt),
          eb.and([
            eb('recorded_at', '=', after.recordedAt),
            eb('id', '<', after.id),
          ]),
        ]),
      )
    }
    return query
      .orderBy('recorded_at', 'desc')
      .orderBy('id', 'desc')
      .limit(limit)
      .execute()
  },
}
