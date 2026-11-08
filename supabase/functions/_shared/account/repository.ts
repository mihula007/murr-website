import type { Executor } from '../db/client.ts'
import type { Database } from '../db/database.types.ts'

type Tables = Database['app']['Tables']
export type ProfileInsert = Tables['profiles']['Insert']
export type ProfileUpdate = Tables['profiles']['Update']
export type ApplicationRow = Tables['join_applications']['Row']

export const NICKNAME_CONSTRAINT = 'profiles_game_nickname_key'
export const PROFILE_PK_CONSTRAINT = 'profiles_pkey'

export const profileRepository = {
  findById(db: Executor, id: string) {
    return db
      .selectFrom('app.profiles')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst()
  },

  /** Ник занят другим пользователем (сравнение с учётом регистра, Q-27). */
  async nicknameTaken(db: Executor, nickname: string, exceptId?: string) {
    let query = db
      .selectFrom('app.profiles')
      .select('id')
      .where('game_nickname', '=', nickname)
    if (exceptId) query = query.where('id', '<>', exceptId)
    return (await query.executeTakeFirst()) !== undefined
  },

  async adminExists(db: Executor) {
    const row = await db
      .selectFrom('app.profiles')
      .select('id')
      .where('access_role', '=', 'admin')
      .limit(1)
      .executeTakeFirst()
    return row !== undefined
  },

  insert(db: Executor, row: ProfileInsert) {
    return db.insertInto('app.profiles').values(row).execute()
  },

  update(db: Executor, id: string, changes: ProfileUpdate) {
    return db
      .updateTable('app.profiles')
      .set(changes)
      .where('id', '=', id)
      .execute()
  },

  async className(db: Executor, classId: number) {
    const row = await db
      .selectFrom('app.character_classes')
      .select('name')
      .where('id', '=', classId)
      .executeTakeFirst()
    return row?.name ?? ''
  },
}

export const applicationRepository = {
  latestForApplicant(db: Executor, applicantId: string) {
    return db
      .selectFrom('app.join_applications')
      .select(['id', 'status', 'submitted_at'])
      .where('applicant_id', '=', applicantId)
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst()
  },

  async create(db: Executor, applicantId: string, links: string[]) {
    const application = await db
      .insertInto('app.join_applications')
      .values({ applicant_id: applicantId, status: 'pending_officer_review' })
      .returning('id')
      .executeTakeFirstOrThrow()
    if (links.length > 0) {
      await db
        .insertInto('app.application_equipment_links')
        .values(
          links.map((url, position) => ({
            application_id: application.id,
            url,
            position,
          })),
        )
        .execute()
    }
    return application.id
  },

  countForApplicant(db: Executor, applicantId: string) {
    return db
      .selectFrom('app.join_applications')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('applicant_id', '=', applicantId)
      .executeTakeFirstOrThrow()
      .then((row) => Number(row.count))
  },
}
