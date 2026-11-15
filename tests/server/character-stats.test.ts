import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { GUEST } from '../../supabase/functions/_shared/auth/actor.ts'
import type { AccessRole } from '../../supabase/functions/_shared/contracts/account.ts'
import {
  getAccount,
  setCharacterStat,
  setCharacterStats,
} from '../../supabase/functions/_shared/accounts/service.ts'
import { listRoster } from '../../supabase/functions/_shared/roster/service.ts'
import {
  actorOf,
  createAuthUser,
  createProfiledUser,
  resetAppData,
  testDb,
  testDeps,
} from './support.ts'

const db = testDb()
const deps = testDeps(db)

beforeEach(() => resetAppData(db))
afterAll(() => db.destroy())

const rejects = (promise: Promise<unknown>, code: string) =>
  expect(promise).rejects.toMatchObject({ code })

async function roleActor(role: AccessRole) {
  const user = await createProfiledUser(db, role)
  return { user, actor: await actorOf(db, user.id) }
}

describe('admin: character stats', () => {
  it('saves all fields at once, writes one audit entry with old and new values, and sends no notification', async () => {
    const admin = await roleActor('admin')
    const target = await roleActor('member')
    await db
      .updateTable('app.profiles')
      .set({ pa: 100, pz: 12.25 })
      .where('id', '=', target.user.id)
      .execute()

    const result = await setCharacterStats(deps, admin.actor, {
      userId: target.user.id,
      pa: '125,5к',
      pz: '12.25',
      bu: '0',
      hp: '2к',
      bd: '500.125',
      source: '  прототип  ',
    })
    expect(result).toEqual({
      userId: target.user.id,
      pa: 125500,
      pz: 12.25,
      bu: 0,
      hp: 2000,
      bd: 500.125,
      characterStatsSource: 'прототип',
    })

    const card = await getAccount(deps, admin.actor, {
      userId: target.user.id,
    })
    expect(card).toMatchObject({
      pa: 125500,
      pz: 12.25,
      bu: 0,
      hp: 2000,
      bd: 500.125,
      characterStatsSource: 'прототип',
    })

    const audit = await db
      .selectFrom('app.audit_log')
      .select(['category', 'action', 'actor_id', 'target_user_id', 'details'])
      .where('target_user_id', '=', target.user.id)
      .execute()
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({
      category: 'profiles',
      action: 'character_stat_changed',
      actor_id: admin.user.id,
      details: {
        user_id: target.user.id,
        changed_fields: ['ПА', 'БУ', 'ХП', 'БД', 'Источник'],
        stat_changes: [
          'ПА: 100 → 125500',
          'БУ: — → 0',
          'ХП: — → 2000',
          'БД: — → 500.125',
          'Источник: — → «прототип»',
        ],
      },
    })

    const notificationCount = await db
      .selectFrom('app.user_notifications')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('recipient_id', '=', target.user.id)
      .executeTakeFirstOrThrow()
    expect(Number(notificationCount.count)).toBe(0)

    await setCharacterStats(deps, admin.actor, {
      userId: target.user.id,
      pa: '125500',
      hp: '2000',
    })
    const repeated = await db
      .selectFrom('app.audit_log')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('target_user_id', '=', target.user.id)
      .executeTakeFirstOrThrow()
    expect(Number(repeated.count)).toBe(1)
  })

  it('keeps the single-field operation for older clients with the same audit', async () => {
    const admin = await roleActor('admin')
    const target = await roleActor('member')
    await setCharacterStat(deps, admin.actor, {
      userId: target.user.id,
      field: 'pa',
      value: '1к',
    })
    const audit = await db
      .selectFrom('app.audit_log')
      .select(['details'])
      .where('target_user_id', '=', target.user.id)
      .execute()
    expect(audit.map((event) => event.details)).toEqual([
      {
        user_id: target.user.id,
        changed_fields: ['ПА'],
        stat_changes: ['ПА: — → 1000'],
      },
    ])
  })

  it('accepts clearing values and rejects invalid numeric and source inputs without changing data', async () => {
    const admin = await roleActor('admin')
    const target = await roleActor('member')
    await db
      .updateTable('app.profiles')
      .set({ pa: 10, pz: 20, character_stats_source: 'сохранено' })
      .where('id', '=', target.user.id)
      .execute()

    for (const value of ['текст', '-1', '1.2345', '1000000000000000']) {
      await expect(
        setCharacterStats(deps, admin.actor, {
          userId: target.user.id,
          pa: value,
        }),
      ).rejects.toMatchObject({
        code: 'validation_failed',
        fields: { pa: 'invalid_number' },
      })
    }
    await expect(
      setCharacterStats(deps, admin.actor, {
        userId: target.user.id,
        pz: '',
        source: 'я'.repeat(161),
      }),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      fields: { source: 'too_long' },
    })

    await setCharacterStats(deps, admin.actor, {
      userId: target.user.id,
      pz: '',
      source: null,
    })
    const card = await getAccount(deps, admin.actor, {
      userId: target.user.id,
    })
    expect(card).toMatchObject({ pa: 10, pz: null, characterStatsSource: null })
  })

  it('allows changes only to admins and rejects profiles pending deletion', async () => {
    const admin = await roleActor('admin')
    const target = await roleActor('member')
    const incomplete = await actorOf(db, (await createAuthUser()).id)

    await rejects(
      setCharacterStat(deps, GUEST, {
        userId: target.user.id,
        field: 'pa',
        value: '1',
      }),
      'not_authenticated',
    )
    await rejects(
      setCharacterStat(deps, incomplete, {
        userId: target.user.id,
        field: 'pa',
        value: '1',
      }),
      'registration_incomplete',
    )
    for (const role of ['applicant', 'reader', 'member', 'officer'] as const) {
      const { actor } = await roleActor(role)
      await rejects(
        setCharacterStats(deps, actor, { userId: target.user.id, pa: '1' }),
        'forbidden',
      )
      await rejects(
        setCharacterStat(deps, actor, {
          userId: target.user.id,
          field: 'pa',
          value: '1',
        }),
        'forbidden',
      )
    }

    await db
      .insertInto('app.user_deletions')
      .values({
        user_id: target.user.id,
        requested_by: admin.user.id,
        nickname: target.user.nickname,
        email: target.user.email,
        stage: 'files',
      })
      .execute()
    await rejects(
      setCharacterStats(deps, admin.actor, { userId: target.user.id, pa: '1' }),
      'state_conflict',
    )
  })

  it('returns only five stats to internal roster roles and keeps the source private', async () => {
    const member = await roleActor('member')
    const target = await roleActor('officer')
    await db
      .updateTable('app.profiles')
      .set({
        pa: 125500,
        pz: 20,
        bu: 30,
        hp: 40,
        bd: 50,
        character_stats_source: 'private',
      })
      .where('id', '=', target.user.id)
      .execute()

    const roster = await listRoster(deps, member.actor)
    const listed = roster.items.find((item) => item.id === target.user.id)
    expect(listed).toMatchObject({ pa: 125500, pz: 20, bu: 30, hp: 40, bd: 50 })
    expect(listed).not.toHaveProperty('characterStatsSource')
    expect(listed).not.toHaveProperty('character_stats_source')

    for (const role of ['applicant', 'reader'] as const) {
      const { actor } = await roleActor(role)
      await rejects(listRoster(deps, actor), 'forbidden')
    }
    await rejects(listRoster(deps, GUEST), 'not_authenticated')
  })
})
