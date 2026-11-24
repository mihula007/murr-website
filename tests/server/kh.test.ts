import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { sql } from 'kysely'
import { GUEST } from '../../supabase/functions/_shared/auth/actor.ts'
import {
  issueKhReward,
  joinKhQueue,
  leaveKhQueue,
  listKhQueues,
} from '../../supabase/functions/_shared/kh/service.ts'
import { setRole } from '../../supabase/functions/_shared/accounts/service.ts'
import { KH_QUEUE_IDS } from '../../supabase/functions/_shared/contracts/kh.ts'
import { actorOf, createProfiledUser, testDb, testDeps } from './support.ts'

const db = testDb()
const deps = testDeps(db)
beforeEach(async () => {
  await db.deleteFrom('app.kh_queue_entries').execute()
})
afterAll(() => db.destroy())

async function createPageMembers(count: number) {
  const prefix = randomUUID().replaceAll('-', '').slice(0, 2)
  const users = Array.from({ length: count }, (_, index) => ({
    id: randomUUID(),
    email: `kh-page-${randomUUID()}@example.test`,
    nickname: `q${prefix}${String(index).padStart(6, '0')}`,
  }))
  await sql`
    insert into auth.users (id, email, email_confirmed_at, aud, role)
    values ${sql.join(
      users.map(
        (user) =>
          sql`(${user.id}::uuid, ${user.email}, now(), 'authenticated', 'authenticated')`,
      ),
      sql`,`,
    )}
  `.execute(db)
  await db
    .insertInto('app.profiles')
    .values(
      users.map((user) => ({
        id: user.id,
        display_name: 'КХ1',
        game_nickname: user.nickname,
        class_id: 1,
        access_role: 'member',
        is_primary_admin: false,
      })),
    )
    .execute()
  return users
}

describe('kh/queues', () => {
  it('returns every queue to internal roles and denies guests, candidates, and readers', async () => {
    for (const role of ['member', 'officer', 'master', 'admin'] as const) {
      const user = await createProfiledUser(db, role)
      const response = await listKhQueues(deps, await actorOf(db, user.id), {})
      expect(Object.keys(response.queues)).toEqual(KH_QUEUE_IDS)
    }

    await expect(listKhQueues(deps, GUEST, {})).rejects.toMatchObject({
      code: 'not_authenticated',
    })
    for (const role of ['applicant', 'reader'] as const) {
      const user = await createProfiledUser(db, role)
      await expect(
        listKhQueues(deps, await actorOf(db, user.id), {}),
      ).rejects.toMatchObject({ code: 'forbidden' })
    }
  })

  it('pages one queue independently without gaps or duplicates', async () => {
    const viewer = await createProfiledUser(db, 'member')
    const users = await createPageMembers(51)
    await db
      .insertInto('app.kh_queue_entries')
      .values(users.map((user) => ({ queue_key: 'summons', user_id: user.id })))
      .execute()
    await db
      .insertInto('app.kh_queue_entries')
      .values({ queue_key: 'pet', user_id: users[0]!.id })
      .execute()

    const actor = await actorOf(db, viewer.id)
    const first = await listKhQueues(deps, actor, {})
    expect(first.queues.summons.items).toHaveLength(50)
    expect(first.queues.summons.nextCursor).toBeTruthy()

    const second = await listKhQueues(deps, actor, {
      cursors: { summons: first.queues.summons.nextCursor },
    })
    expect(second.queues.summons.items).toHaveLength(1)
    expect(second.queues.summons.nextCursor).toBeNull()
    expect(second.queues.pet.items).toHaveLength(0)
    expect(second.queues.pet.nextCursor).toBeNull()
    expect(first.queues.summons.items.at(-1)?.id).not.toBe(
      second.queues.summons.items[0]?.id,
    )
  })

  it('lets an eligible account join all queues once and prevents a duplicate', async () => {
    const member = await createProfiledUser(db, 'member')
    const actor = await actorOf(db, member.id)

    const entries = await Promise.all(
      KH_QUEUE_IDS.map((queueKey) => joinKhQueue(deps, actor, { queueKey })),
    )
    expect(entries).toHaveLength(14)
    await expect(
      joinKhQueue(deps, actor, { queueKey: KH_QUEUE_IDS[0] }),
    ).rejects.toMatchObject({ code: 'state_conflict' })

    const queues = await listKhQueues(deps, actor, {})
    expect(queues.queues.summons.items).toHaveLength(1)
    expect(queues.queues.pet.items).toHaveLength(1)
  })

  it('allows officers and administrators to join but not masters', async () => {
    const officer = await createProfiledUser(db, 'officer')
    const admin = await createProfiledUser(db, 'admin')
    const master = await createProfiledUser(db, 'master')

    await joinKhQueue(deps, await actorOf(db, officer.id), {
      queueKey: 'summons',
    })
    await joinKhQueue(deps, await actorOf(db, admin.id), {
      queueKey: 'pet',
    })
    await expect(
      joinKhQueue(deps, await actorOf(db, master.id), {
        queueKey: 'summons',
      }),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('keeps concurrent attempts from creating duplicate entries', async () => {
    const member = await createProfiledUser(db, 'member')
    const actor = await actorOf(db, member.id)
    const results = await Promise.allSettled([
      joinKhQueue(deps, actor, { queueKey: 'summons' }),
      joinKhQueue(deps, actor, { queueKey: 'summons' }),
    ])

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1)
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1)
    const queues = await listKhQueues(deps, actor, {})
    expect(queues.queues.summons.items).toHaveLength(1)
  })

  it('allows only a participant to remove their own entry', async () => {
    const member = await createProfiledUser(db, 'member')
    const other = await createProfiledUser(db, 'officer')
    const memberActor = await actorOf(db, member.id)
    const entry = await joinKhQueue(deps, memberActor, {
      queueKey: 'summons',
    })

    await expect(
      leaveKhQueue(deps, await actorOf(db, other.id), {
        queueKey: 'summons',
        entryId: entry.entryId,
      }),
    ).rejects.toMatchObject({ code: 'not_found' })

    await leaveKhQueue(deps, memberActor, {
      queueKey: 'summons',
      entryId: entry.entryId,
    })
    const queues = await listKhQueues(deps, memberActor, {})
    expect(queues.queues.summons.items).toHaveLength(0)
  })

  it('allows only the master to issue and removes the active entry', async () => {
    const member = await createProfiledUser(db, 'member')
    const officer = await createProfiledUser(db, 'officer')
    const admin = await createProfiledUser(db, 'admin')
    const master = await createProfiledUser(db, 'master')
    const memberActor = await actorOf(db, member.id)
    const entry = await joinKhQueue(deps, memberActor, {
      queueKey: 'summons',
    })

    for (const user of [member, officer, admin]) {
      await expect(
        issueKhReward(deps, await actorOf(db, user.id), {
          queueKey: 'summons',
          entryId: entry.entryId,
        }),
      ).rejects.toMatchObject({ code: 'forbidden' })
    }

    await issueKhReward(deps, await actorOf(db, master.id), {
      queueKey: 'summons',
      entryId: entry.entryId,
    })
    const queues = await listKhQueues(deps, memberActor, {})
    expect(queues.queues.summons.items).toHaveLength(0)
  })

  it('removes queue entries in the same role change that removes access', async () => {
    const admin = await createProfiledUser(db, 'admin')
    const member = await createProfiledUser(db, 'member')
    const memberActor = await actorOf(db, member.id)
    await joinKhQueue(deps, memberActor, { queueKey: 'summons' })

    await setRole(deps, await actorOf(db, admin.id), {
      userId: member.id,
      role: 'reader',
    })

    const rows = await db
      .selectFrom('app.kh_queue_entries')
      .select('id')
      .where('user_id', '=', member.id)
      .execute()
    expect(rows).toHaveLength(0)
  })
})
