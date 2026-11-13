import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  listAccounts,
  restoreReader,
  setRole,
} from '../../supabase/functions/_shared/accounts/service.ts'
import { applicationRepository } from '../../supabase/functions/_shared/applications/repository.ts'
import { GUEST } from '../../supabase/functions/_shared/auth/actor.ts'
import type { AccessRole } from '../../supabase/functions/_shared/contracts/account.ts'
import { moscowDate } from '../../supabase/functions/_shared/membership.ts'
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

const today = () => moscowDate(new Date())

async function roleActor(role: AccessRole) {
  const user = await createProfiledUser(db, role)
  return { user, actor: await actorOf(db, user.id) }
}

async function profile(id: string) {
  return db
    .selectFrom('app.profiles')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow()
}

async function setProfile(id: string, values: Record<string, unknown>) {
  await db
    .updateTable('app.profiles')
    .set(values)
    .where('id', '=', id)
    .execute()
}

async function audit() {
  return db
    .selectFrom('app.audit_log')
    .select(['action', 'category', 'actor_id', 'target_user_id', 'details'])
    .orderBy('id')
    .execute()
}

describe('accounts/list', () => {
  it('is available only to admins', async () => {
    await rejects(listAccounts(deps, GUEST, {}), 'not_authenticated')
    const incomplete = await actorOf(db, (await createAuthUser()).id)
    await rejects(listAccounts(deps, incomplete, {}), 'registration_incomplete')
    for (const role of ['applicant', 'reader', 'member', 'officer'] as const) {
      await rejects(
        listAccounts(deps, (await roleActor(role)).actor, {}),
        'forbidden',
      )
    }
  })

  it('pages accounts by nickname with a cursor', async () => {
    const { user: admin, actor } = await roleActor('admin')
    await setProfile(admin.id, { game_nickname: 'c' })
    for (const nickname of ['a', 'e', 'b', 'd']) {
      const user = await createProfiledUser(db, 'applicant')
      await setProfile(user.id, { game_nickname: nickname })
    }
    const first = await listAccounts(deps, actor, { limit: 3 })
    expect(first.items.map((a) => a.gameNickname)).toEqual(['a', 'b', 'c'])
    const second = await listAccounts(deps, actor, {
      cursor: first.nextCursor,
      limit: 3,
    })
    expect(second.items.map((a) => a.gameNickname)).toEqual(['d', 'e'])
    expect(second.nextCursor).toBeNull()
  })

  it('lists every profile with email, role and protection flags', async () => {
    const { user: admin, actor } = await roleActor('admin')
    await setProfile(admin.id, {
      is_primary_admin: true,
      joined_on: '2026-01-01',
    })
    const applicant = await createProfiledUser(db, 'applicant')
    await applicationRepository.create(db, applicant.id, [])
    await createProfiledUser(db, 'reader')

    const { items: accounts, nextCursor } = await listAccounts(deps, actor, {})
    expect(accounts).toHaveLength(3)
    expect(nextCursor).toBeNull()
    expect(accounts.find((a) => a.id === admin.id)).toMatchObject({
      id: admin.id,
      gameNickname: admin.nickname,
      displayName: 'Тест',
      email: admin.email,
      role: 'admin',
      joinedOn: '2026-01-01',
      isPrimaryAdmin: true,
      hasActiveApplication: false,
      applicationStatus: null,
      deletionPending: false,
    })
    expect(accounts.find((a) => a.id === applicant.id)).toMatchObject({
      role: 'applicant',
      hasActiveApplication: true,
    })
  })
})

describe('accounts/set-role', () => {
  it('is available only to admins: officers neither change roles nor block (ACL-03, ADM-09)', async () => {
    const member = await createProfiledUser(db, 'member')
    await rejects(
      setRole(deps, GUEST, { userId: member.id, role: 'reader' }),
      'not_authenticated',
    )
    for (const role of ['applicant', 'reader', 'member', 'officer'] as const) {
      const { actor } = await roleActor(role)
      for (const next of ['reader', 'officer'] as const) {
        await rejects(
          setRole(deps, actor, { userId: member.id, role: next }),
          'forbidden',
        )
      }
    }
    expect((await profile(member.id)).access_role).toBe('member')
    expect(await audit()).toHaveLength(0)
  })

  it('blocks a member: reader role, join date kept, audit, roster access lost at once (ADM-08)', async () => {
    const { user: admin, actor } = await roleActor('admin')
    const { user: member, actor: memberBefore } = await roleActor('member')
    await setProfile(member.id, { joined_on: '2026-02-03' })
    await listRoster(deps, memberBefore)

    const result = await setRole(deps, actor, {
      userId: member.id,
      role: 'reader',
    })
    expect(result).toEqual({
      userId: member.id,
      role: 'reader',
      joinedOn: '2026-02-03',
    })
    expect(await profile(member.id)).toMatchObject({
      access_role: 'reader',
      joined_on: '2026-02-03',
    })
    expect(await audit()).toEqual([
      {
        action: 'member_blocked',
        category: 'participants',
        actor_id: admin.id,
        target_user_id: member.id,
        details: {
          user_id: member.id,
          previous_role: 'member',
          role: 'reader',
        },
      },
    ])
    await rejects(listRoster(deps, await actorOf(db, member.id)), 'forbidden')
  })

  it('changes roles between internal roles without touching the join date', async () => {
    const { actor } = await roleActor('admin')
    const member = await createProfiledUser(db, 'member')
    await setProfile(member.id, { joined_on: '2026-02-03' })

    await setRole(deps, actor, { userId: member.id, role: 'officer' })
    expect(await profile(member.id)).toMatchObject({
      access_role: 'officer',
      joined_on: '2026-02-03',
    })
    const [event] = await audit()
    expect(event).toMatchObject({
      action: 'role_changed',
      details: { previous_role: 'member', role: 'officer' },
    })
  })

  it('sets today as the join date when a reader or applicant becomes internal', async () => {
    const { actor } = await roleActor('admin')
    const reader = await createProfiledUser(db, 'reader')
    await setProfile(reader.id, { joined_on: '2025-05-05' })
    const applicant = await createProfiledUser(db, 'applicant')

    await setRole(deps, actor, { userId: reader.id, role: 'officer' })
    await setRole(deps, actor, { userId: applicant.id, role: 'member' })
    expect((await profile(reader.id)).joined_on).toBe(today())
    expect((await profile(applicant.id)).joined_on).toBe(today())
  })

  it('leaves the same role unchanged and unaudited', async () => {
    const { actor } = await roleActor('admin')
    const member = await createProfiledUser(db, 'member')
    expect(
      await setRole(deps, actor, { userId: member.id, role: 'member' }),
    ).toMatchObject({ role: 'member' })
    expect(await audit()).toHaveLength(0)
  })

  it('refuses unknown users and invalid roles', async () => {
    const { actor } = await roleActor('admin')
    await rejects(
      setRole(deps, actor, {
        userId: '00000000-0000-4000-8000-000000000000',
        role: 'member',
      }),
      'not_found',
    )
    const member = await createProfiledUser(db, 'member')
    await rejects(
      setRole(deps, actor, { userId: member.id, role: 'owner' }),
      'validation_failed',
    )
  })

  it('never demotes the primary admin, even by the admin themself (ACL-07)', async () => {
    const { user: primary, actor: primaryActor } = await roleActor('admin')
    await setProfile(primary.id, { is_primary_admin: true })
    const { actor } = await roleActor('admin')
    for (const executor of [actor, primaryActor]) {
      await rejects(
        setRole(deps, executor, { userId: primary.id, role: 'member' }),
        'primary_admin',
      )
    }
    expect((await profile(primary.id)).access_role).toBe('admin')
    expect(await audit()).toHaveLength(0)
  })

  it('never demotes the last admin (ADM-06)', async () => {
    const { user, actor } = await roleActor('admin')
    await rejects(
      setRole(deps, actor, { userId: user.id, role: 'reader' }),
      'last_admin',
    )
    expect((await profile(user.id)).access_role).toBe('admin')
  })

  it('lets an admin step down while another admin remains', async () => {
    const { user, actor } = await roleActor('admin')
    await createProfiledUser(db, 'admin')
    await setRole(deps, actor, { userId: user.id, role: 'officer' })
    expect((await profile(user.id)).access_role).toBe('officer')
  })

  it('keeps one admin when two admins demote each other in parallel', async () => {
    const first = await roleActor('admin')
    const second = await roleActor('admin')
    const results = await Promise.allSettled([
      setRole(deps, first.actor, { userId: second.user.id, role: 'member' }),
      setRole(deps, second.actor, { userId: first.user.id, role: 'member' }),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const failed = results.find((r) => r.status === 'rejected')
    expect(failed?.reason).toMatchObject({ code: 'last_admin' })
    const admins = await db
      .selectFrom('app.profiles')
      .select('id')
      .where('access_role', '=', 'admin')
      .execute()
    expect(admins).toHaveLength(1)
    expect(await audit()).toHaveLength(1)
  })

  it('refuses to change an applicant with an active application', async () => {
    const { actor } = await roleActor('admin')
    const applicant = await createProfiledUser(db, 'applicant')
    await applicationRepository.create(db, applicant.id, [])
    await rejects(
      setRole(deps, actor, { userId: applicant.id, role: 'member' }),
      'application_pending',
    )
    expect((await profile(applicant.id)).access_role).toBe('applicant')
  })
})

describe('accounts/restore-reader', () => {
  it('lets officers and admins restore a reader as a member from today (ACL-06)', async () => {
    for (const role of ['officer', 'admin'] as const) {
      const { user: keeper, actor } = await roleActor(role)
      const reader = await createProfiledUser(db, 'reader')
      await setProfile(reader.id, { joined_on: '2025-05-05' })

      expect(await restoreReader(deps, actor, { userId: reader.id })).toEqual({
        userId: reader.id,
        role: 'member',
        joinedOn: today(),
      })
      expect(await profile(reader.id)).toMatchObject({
        access_role: 'member',
        joined_on: today(),
      })
      expect((await audit()).at(-1)).toEqual({
        action: 'reader_restored',
        category: 'participants',
        actor_id: keeper.id,
        target_user_id: reader.id,
        details: {
          user_id: reader.id,
          previous_role: 'reader',
          role: 'member',
        },
      })
      await listRoster(deps, await actorOf(db, reader.id))
    }
  })

  it('is closed to guests, applicants, readers and members', async () => {
    const reader = await createProfiledUser(db, 'reader')
    await rejects(
      restoreReader(deps, GUEST, { userId: reader.id }),
      'not_authenticated',
    )
    for (const role of ['applicant', 'reader', 'member'] as const) {
      await rejects(
        restoreReader(deps, (await roleActor(role)).actor, {
          userId: reader.id,
        }),
        'forbidden',
      )
    }
    expect((await profile(reader.id)).access_role).toBe('reader')
  })

  it('refuses to restore anyone but a reader', async () => {
    const { actor } = await roleActor('officer')
    for (const role of ['applicant', 'member', 'admin'] as const) {
      const target = await createProfiledUser(db, role)
      await rejects(
        restoreReader(deps, actor, { userId: target.id }),
        'state_conflict',
      )
      expect((await profile(target.id)).access_role).toBe(role)
    }
    await rejects(
      restoreReader(deps, actor, {
        userId: '00000000-0000-4000-8000-000000000000',
      }),
      'not_found',
    )
    expect(await audit()).toHaveLength(0)
  })
})
