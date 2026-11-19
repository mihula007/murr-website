import type { Executor } from '../db/client.ts'
import type { OfficerPermissionCode } from '../contracts/officer-permissions.ts'

export const officerPermissionsRepository = {
  listOfficers(db: Executor) {
    return db
      .selectFrom('app.profiles')
      .select(['id', 'game_nickname'])
      .where('access_role', '=', 'officer')
      .orderBy('game_nickname')
      .orderBy('id')
      .execute()
  },

  async listEnabled(db: Executor, officerIds: string[]) {
    if (officerIds.length === 0) {
      return []
    }
    return db
      .selectFrom('app.officer_permissions')
      .select(['officer_id', 'permission_code'])
      .where('officer_id', 'in', officerIds)
      .orderBy('permission_code')
      .execute()
  },

  listForOfficer(db: Executor, officerId: string) {
    return db
      .selectFrom('app.officer_permissions')
      .select('permission_code')
      .where('officer_id', '=', officerId)
      .execute()
  },

  async has(db: Executor, officerId: string, code: OfficerPermissionCode) {
    const row = await db
      .selectFrom('app.officer_permissions')
      .select('permission_code')
      .where('officer_id', '=', officerId)
      .where('permission_code', '=', code)
      .executeTakeFirst()
    return row !== undefined
  },

  findOfficerForUpdate(db: Executor, id: string) {
    return db
      .selectFrom('app.profiles')
      .select(['id', 'game_nickname', 'access_role'])
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst()
  },

  delete(db: Executor, officerId: string, code: OfficerPermissionCode) {
    return db
      .deleteFrom('app.officer_permissions')
      .where('officer_id', '=', officerId)
      .where('permission_code', '=', code)
      .execute()
  },

  insert(db: Executor, officerId: string, code: OfficerPermissionCode) {
    return db
      .insertInto('app.officer_permissions')
      .values({ officer_id: officerId, permission_code: code })
      .execute()
  },
}
