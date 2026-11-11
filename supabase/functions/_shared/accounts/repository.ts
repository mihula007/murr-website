import type { Executor } from '../db/client.ts'
import { ACTIVE_STATUSES } from '../applications/repository.ts'
import type { NicknameKey } from '../roster/repository.ts'

/** Профили с email и признаком активной заявки. */
function accounts(db: Executor) {
  return db
    .selectFrom('app.profiles as p')
    .innerJoin('auth.users as u', 'u.id', 'p.id')
    .select((eb) => [
      'p.id',
      'p.game_nickname',
      'p.display_name',
      'u.email',
      'p.access_role',
      'p.joined_on',
      'p.is_primary_admin',
      eb
        .exists(
          eb
            .selectFrom('app.join_applications as a')
            .select('a.id')
            .whereRef('a.applicant_id', '=', 'p.id')
            .where('a.status', 'in', ACTIVE_STATUSES),
        )
        .as('has_active_application'),
    ])
}

export const accountRepository = {
  /** Страница по нику (keyset после `(ник, id)` курсора). */
  listPage(db: Executor, after: NicknameKey | null, limit: number) {
    let query = accounts(db)
    if (after) {
      query = query.where((eb) =>
        eb(
          eb.refTuple('p.game_nickname', 'p.id'),
          '>',
          eb.tuple(after.gameNickname, after.id),
        ),
      )
    }
    return query
      .orderBy('p.game_nickname')
      .orderBy('p.id')
      .limit(limit)
      .execute()
  },

  findById(db: Executor, id: string) {
    return accounts(db).where('p.id', '=', id).executeTakeFirst()
  },

  /**
   * Блокирует строки всех администраторов до конца транзакции. Вызывается
   * первым в смене роли, всегда в одном порядке, — параллельные понижения
   * ждут друг друга без взаимной блокировки и не оставят клан без
   * администратора (ACL-07, ADM-06).
   */
  lockAdmins(tx: Executor) {
    return tx
      .selectFrom('app.profiles')
      .select(['id', 'is_primary_admin'])
      .where('access_role', '=', 'admin')
      .orderBy('id')
      .forUpdate()
      .execute()
  },
}
