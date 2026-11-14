import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { GUEST } from '../../supabase/functions/_shared/auth/actor.ts'
import type { AccessRole } from '../../supabase/functions/_shared/contracts/account.ts'
import {
  getAccount,
  setCharacterStat,
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
  it('updates each field, returns the admin card, audits changes, and sends no notification', async () => {
    const admin = await roleActor('admin')
    const target = await roleActor('member')
    const changes = [
      ['pa', '125,5к', 125500],
      ['pz', '12.25', 12.25],
      ['bu', '0', 0],
      ['hp', '2к', 2000],
      ['bd', '500.125', 500.125],
      ['source', '  прототип  ', 'прототип'],
    ] as const

    for (const [field, value] of changes) {
      await setCharacterStat(deps, admin.actor, {
        userId: target.user.id,
        field,
        value,
      })
    }

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
    expect(audit).toHaveLength(6)
    expect(audit.every((event) => event.category === 'profiles')).toBe(true)
    expect(
      audit.every((event) => event.action === 'character_stat_changed'),
    ).toBe(true)
    expect(audit.every((event) => event.actor_id === admin.user.id)).toBe(true)
    expect(
      audit.map(
        (event) => (event.details as Record<string, unknown>).changed_fields,
      ),
    ).toEqual([['ПА'], ['ПЗ'], ['БУ'], ['ХП'], ['БД'], ['Источник']])

    const notificationCount = await db
      .selectFrom('app.user_notifications')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('recipient_id', '=', target.user.id)
      .executeTakeFirstOrThrow()
    expect(Number(notificationCount.count)).toBe(0)

    await setCharacterStat(deps, admin.actor, {
      userId: target.user.id,
      field: 'pa',
      value: '125500',
    })
    const repeated = await db
      .selectFrom('app.audit_log')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('target_user_id', '=', target.user.id)
      .executeTakeFirstOrThrow()
    expect(Number(repeated.count)).toBe(6)
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
        setCharacterStat(deps, admin.actor, {
          userId: target.user.id,
          field: 'pa',
          value,
        }),
      ).rejects.toMatchObject({
        code: 'validation_failed',
        fields: { value: 'invalid_number' },
      })
    }
    await expect(
      setCharacterStat(deps, admin.actor, {
        userId: target.user.id,
        field: 'source',
        value: 'я'.repeat(161),
      }),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      fields: { value: 'too_long' },
    })

    await setCharacterStat(deps, admin.actor, {
      userId: target.user.id,
      field: 'pz',
      value: '',
    })
    await setCharacterStat(deps, admin.actor, {
      userId: target.user.id,
      field: 'source',
      value: null,
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
      setCharacterStat(deps, admin.actor, {
        userId: target.user.id,
        field: 'pa',
        value: '1',
      }),
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
