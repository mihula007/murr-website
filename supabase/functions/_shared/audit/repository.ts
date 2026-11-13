import { sql } from 'kysely'
import type { Executor } from '../db/client.ts'
import type { Database } from '../db/database.types.ts'

export type AuditInsert = Database['app']['Tables']['audit_log']['Insert']

export const AUDIT_LIMIT = 1000
// Ключ блокировки, упорядочивающий вставку и вытеснение записей аудита.
const AUDIT_LOCK_KEY = 4_202_611

export type AuditListOptions = {
  category: string | null
  search: string | null
  /** Курсор: `id` последней показанной записи (id растёт со временем). */
  beforeId: number | null
  limit: number
}

export const auditRepository = {
  /** Журнал от новых к старым с категорией и поиском (ADM-10, ADM-12). */
  list(db: Executor, options: AuditListOptions) {
    let query = db
      .selectFrom('app.audit_log')
      .select([
        'id',
        'created_at',
        'category',
        'action',
        'summary',
        'actor_role',
        'actor_nickname',
        'actor_email',
        'target_kind',
        'target_id',
        'target_nickname',
        'target_email',
        'details',
      ])
    if (options.category) {
      query = query.where('category', '=', options.category)
    }
    if (options.search) {
      const pattern = `%${options.search.replace(/[\\%_]/g, '\\$&')}%`
      query = query.where((eb) =>
        eb.or([
          eb('actor_nickname', 'ilike', pattern),
          eb('actor_email', 'ilike', pattern),
          eb('target_nickname', 'ilike', pattern),
          eb('target_email', 'ilike', pattern),
          eb('action', 'ilike', pattern),
          eb('summary', 'ilike', pattern),
        ]),
      )
    }
    if (options.beforeId !== null) {
      query = query.where('id', '<', options.beforeId)
    }
    return query.orderBy('id', 'desc').limit(options.limit).execute()
  },

  async lock(tx: Executor) {
    await sql`select pg_advisory_xact_lock(${AUDIT_LOCK_KEY})`.execute(tx)
  },

  async insert(tx: Executor, row: AuditInsert) {
    return tx
      .insertInto('app.audit_log')
      .values(row)
      .returning('id')
      .executeTakeFirstOrThrow()
  },

  /** Оставляет только последние `limit` записей. */
  async trimToLatest(tx: Executor, limit = AUDIT_LIMIT) {
    const boundary = await tx
      .selectFrom('app.audit_log')
      .select('id')
      .orderBy('id', 'desc')
      .offset(limit - 1)
      .limit(1)
      .executeTakeFirst()
    if (!boundary) {
      return
    }
    await tx.deleteFrom('app.audit_log').where('id', '<', boundary.id).execute()
  },

  async count(db: Executor) {
    const row = await db
      .selectFrom('app.audit_log')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .executeTakeFirstOrThrow()
    return Number(row.count)
  },
}
