import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { sql } from 'kysely'
import { GUEST } from '../../supabase/functions/_shared/auth/actor.ts'
import {
  issueKhReward,
  getKhQueueSettings,
  joinKhQueue,
  leaveKhQueue,
  listKhQueues,
  removeKhQueueEntry,
  setKhQueueLimit,
  setKhQueueRepeat,
  khRewardHistory,
} from '../../supabase/functions/_shared/kh/service.ts'
import { setRole } from '../../supabase/functions/_shared/accounts/service.ts'
import { KH_QUEUE_IDS } from '../../supabase/functions/_shared/contracts/kh.ts'
import { actorOf, createProfiledUser, testDb, testDeps } from './support.ts'

const db = testDb()
const deps = testDeps(db)
beforeEach(async () => {
  await db.deleteFrom('app.kh_reward_history').execute()
  await db.deleteFrom('app.kh_queue_rejoin_waitlist').execute()
  await db.deleteFrom('app.kh_queue_entries').execute()
  await db
    .updateTable('app.kh_queue_settings')
    .set({ max_active_queues: 14 })
    .where('id', '=', true)
    .execute()
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
      .values(
        users.map((user) => ({
          queue_key: 'summons',
          user_id: user.id,
          game_nickname: user.nickname,
        })),
      )
      .execute()
    await db
      .insertInto('app.kh_queue_entries')
      .values({
        queue_key: 'pet',
        user_id: users[0]!.id,
        game_nickname: users[0]!.nickname,
      })
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

  it('defaults to fourteen entries and applies the shared cap to every join role', async () => {
    const member = await createProfiledUser(db, 'member')
    const officer = await createProfiledUser(db, 'officer')
    const admin = await createProfiledUser(db, 'admin')
    const adminActor = await actorOf(db, admin.id)
    const memberActor = await actorOf(db, member.id)
    const officerActor = await actorOf(db, officer.id)

    await expect(getKhQueueSettings(deps, adminActor)).resolves.toEqual({
      maxActiveQueues: 14,
      activeQueueCount: 0,
    })
    await setKhQueueLimit(deps, adminActor, { maxActiveQueues: 1 })
    await joinKhQueue(deps, memberActor, { queueKey: 'summons' })
    await joinKhQueue(deps, officerActor, { queueKey: 'pet' })
    await joinKhQueue(deps, adminActor, { queueKey: 'meteorites' })

    await expect(
      joinKhQueue(deps, memberActor, { queueKey: 'pet' }),
    ).rejects.toMatchObject({ code: 'state_conflict' })
    await expect(
      joinKhQueue(deps, officerActor, { queueKey: 'summons' }),
    ).rejects.toMatchObject({ code: 'state_conflict' })
    await expect(
      joinKhQueue(deps, adminActor, { queueKey: 'pet' }),
    ).rejects.toMatchObject({ code: 'state_conflict' })
  })

  it('allows only administrators and masters to view and change the global cap', async () => {
    const member = await createProfiledUser(db, 'member')
    const officer = await createProfiledUser(db, 'officer')
    const master = await createProfiledUser(db, 'master')
    const admin = await createProfiledUser(db, 'admin')

    for (const user of [member, officer]) {
      const actor = await actorOf(db, user.id)
      await expect(
        setKhQueueLimit(deps, actor, { maxActiveQueues: 3 }),
      ).rejects.toMatchObject({ code: 'forbidden' })
    }
    await expect(
      setKhQueueLimit(deps, await actorOf(db, master.id), {
        maxActiveQueues: 14,
      }),
    ).resolves.toEqual({ maxActiveQueues: 14 })
    await expect(
      setKhQueueLimit(deps, await actorOf(db, admin.id), {
        maxActiveQueues: 1,
      }),
    ).resolves.toEqual({ maxActiveQueues: 1 })
  })

  it('does not remove existing entries when the cap is lowered', async () => {
    const admin = await createProfiledUser(db, 'admin')
    const member = await createProfiledUser(db, 'member')
    const adminActor = await actorOf(db, admin.id)
    const memberActor = await actorOf(db, member.id)
    await setKhQueueLimit(deps, adminActor, { maxActiveQueues: 2 })
    await joinKhQueue(deps, memberActor, { queueKey: 'summons' })
    await joinKhQueue(deps, memberActor, { queueKey: 'pet' })

    await setKhQueueLimit(deps, adminActor, { maxActiveQueues: 1 })
    await expect(
      joinKhQueue(deps, memberActor, { queueKey: 'meteorites' }),
    ).rejects.toMatchObject({ code: 'state_conflict' })
    const queues = await listKhQueues(deps, memberActor, {})
    expect(queues.queues.summons.items).toHaveLength(1)
    expect(queues.queues.pet.items).toHaveLength(1)
  })

  it('serializes concurrent joins to different queues against the same cap', async () => {
    const admin = await createProfiledUser(db, 'admin')
    const member = await createProfiledUser(db, 'member')
    const adminActor = await actorOf(db, admin.id)
    const memberActor = await actorOf(db, member.id)
    await setKhQueueLimit(deps, adminActor, { maxActiveQueues: 1 })

    const results = await Promise.allSettled([
      joinKhQueue(deps, memberActor, { queueKey: 'summons' }),
      joinKhQueue(deps, memberActor, { queueKey: 'pet' }),
    ])
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1)
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1)
    const rows = await db
      .selectFrom('app.kh_queue_entries')
      .select('id')
      .where('user_id', '=', member.id)
      .execute()
    expect(rows).toHaveLength(1)
  })

  it('shows nickname-only rows without an account', async () => {
    const member = await createProfiledUser(db, 'member')
    await db
      .insertInto('app.kh_queue_entries')
      .values({
        queue_key: 'summons',
        user_id: null,
        game_nickname: 'Вне аккаунта',
      })
      .execute()

    const queues = await listKhQueues(deps, await actorOf(db, member.id), {})
    expect(queues.queues.summons.items).toContainEqual(
      expect.objectContaining({ userId: null, gameNickname: 'Вне аккаунта' }),
    )
  })

  it('lets a master remove another participant but not an administrator', async () => {
    const admin = await createProfiledUser(db, 'admin')
    const master = await createProfiledUser(db, 'master')
    const member = await createProfiledUser(db, 'member')
    const entry = await joinKhQueue(deps, await actorOf(db, member.id), {
      queueKey: 'summons',
    })

    await expect(
      removeKhQueueEntry(deps, await actorOf(db, admin.id), {
        queueKey: 'summons',
        entryId: entry.entryId,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' })
    await expect(
      removeKhQueueEntry(deps, await actorOf(db, master.id), {
        queueKey: 'summons',
        entryId: entry.entryId,
      }),
    ).resolves.toEqual({ ok: true })
  })

  it('preserves enabled repeat and appends the member after an issue', async () => {
    const member = await createProfiledUser(db, 'member')
    const master = await createProfiledUser(db, 'master')
    const memberActor = await actorOf(db, member.id)
    const entry = await joinKhQueue(deps, memberActor, { queueKey: 'summons' })
    await setKhQueueRepeat(deps, memberActor, {
      queueKey: 'summons',
      entryId: entry.entryId,
      autoRejoin: true,
    })

    await issueKhReward(deps, await actorOf(db, master.id), {
      queueKey: 'summons',
      entryId: entry.entryId,
    })
    const queues = await listKhQueues(deps, memberActor, {})
    expect(queues.queues.summons.items).toContainEqual(
      expect.objectContaining({
        userId: member.id,
        gameNickname: member.nickname,
        autoRejoin: true,
      }),
    )
  })

  it('holds auto-repeat until the member is under the lowered cap', async () => {
    const admin = await createProfiledUser(db, 'admin')
    const member = await createProfiledUser(db, 'member')
    const master = await createProfiledUser(db, 'master')
    const adminActor = await actorOf(db, admin.id)
    const memberActor = await actorOf(db, member.id)
    await setKhQueueLimit(deps, adminActor, { maxActiveQueues: 2 })
    const summons = await joinKhQueue(deps, memberActor, {
      queueKey: 'summons',
    })
    await joinKhQueue(deps, memberActor, { queueKey: 'pet' })
    await setKhQueueRepeat(deps, memberActor, {
      queueKey: 'summons',
      entryId: summons.entryId,
      autoRejoin: true,
    })
    await setKhQueueLimit(deps, adminActor, { maxActiveQueues: 1 })

    await issueKhReward(deps, await actorOf(db, master.id), {
      queueKey: 'summons',
      entryId: summons.entryId,
    })
    expect(
      await db
        .selectFrom('app.kh_queue_rejoin_waitlist')
        .select('id')
        .where('user_id', '=', member.id)
        .execute(),
    ).toHaveLength(1)

    await leaveKhQueue(deps, memberActor, {
      queueKey: 'pet',
      entryId: (await listKhQueues(deps, memberActor, {})).queues.pet.items[0]!
        .id,
    })
    const queues = await listKhQueues(deps, memberActor, {})
    expect(queues.queues.summons.items).toContainEqual(
      expect.objectContaining({ userId: member.id, autoRejoin: true }),
    )
    expect(
      await db
        .selectFrom('app.kh_queue_rejoin_waitlist')
        .select('id')
        .where('user_id', '=', member.id)
        .execute(),
    ).toHaveLength(0)
  })

  it('records a master issue and exposes history only to administrators and masters', async () => {
    const member = await createProfiledUser(db, 'member')
    const officer = await createProfiledUser(db, 'officer')
    const admin = await createProfiledUser(db, 'admin')
    const master = await createProfiledUser(db, 'master')
    const memberActor = await actorOf(db, member.id)
    const entry = await joinKhQueue(deps, memberActor, { queueKey: 'summons' })

    await issueKhReward(deps, await actorOf(db, master.id), {
      queueKey: 'summons',
      entryId: entry.entryId,
    })

    for (const user of [member, officer]) {
      await expect(
        khRewardHistory(deps, await actorOf(db, user.id), {}),
      ).rejects.toMatchObject({ code: 'forbidden' })
    }
    for (const user of [admin, master]) {
      const history = await khRewardHistory(
        deps,
        await actorOf(db, user.id),
        {},
      )
      expect(history.items[0]).toMatchObject({
        queueKey: 'summons',
        rewardName: 'призывы',
        userId: member.id,
        gameNickname: member.nickname,
      })
      expect(history.items[0]?.issuedAt).toMatch(/^\d{4}-\d\d-\d\dT/)
    }
  })

  it('filters history by inclusive Moscow calendar dates', async () => {
    const admin = await createProfiledUser(db, 'admin')
    await db
      .insertInto('app.kh_reward_history')
      .values([
        {
          queue_key: 'summons',
          user_id: null,
          issued_by: null,
          game_nickname: 'До начала',
          issued_at: '2026-11-25T20:59:59.999Z',
        },
        {
          queue_key: 'pet',
          user_id: null,
          issued_by: null,
          game_nickname: 'Внутри периода',
          issued_at: '2026-11-25T21:00:00.000Z',
        },
        {
          queue_key: 'disc',
          user_id: null,
          issued_by: null,
          game_nickname: 'До конца дня',
          issued_at: '2026-11-26T20:59:59.999Z',
        },
        {
          queue_key: 'disc',
          user_id: null,
          issued_by: null,
          game_nickname: 'После конца',
          issued_at: '2026-11-26T21:00:00.000Z',
        },
      ])
      .execute()

    const history = await khRewardHistory(deps, await actorOf(db, admin.id), {
      dateFrom: '2026-11-26',
      dateTo: '2026-11-26',
    })
    expect(history.items.map((row) => row.gameNickname)).toEqual([
      'До конца дня',
      'Внутри периода',
    ])
  })

  it('pages history by issue time and ID without duplicates', async () => {
    const admin = await createProfiledUser(db, 'admin')
    await db
      .insertInto('app.kh_reward_history')
      .values(
        Array.from({ length: 21 }, (_, index) => ({
          queue_key: 'summons' as const,
          user_id: null,
          issued_by: null,
          game_nickname: `Запись ${index}`,
          issued_at: '2026-11-10T12:00:00.000Z',
        })),
      )
      .execute()

    const actor = await actorOf(db, admin.id)
    const first = await khRewardHistory(deps, actor, {
      dateFrom: '2026-11-01',
      dateTo: '2026-11-30',
    })
    expect(first.items).toHaveLength(20)
    expect(first.nextCursor).toBeTruthy()
    const second = await khRewardHistory(deps, actor, {
      dateFrom: '2026-11-01',
      dateTo: '2026-11-30',
      cursor: first.nextCursor,
    })
    expect(second.items).toHaveLength(1)
    expect(second.nextCursor).toBeNull()
    expect(first.items.at(-1)?.id).not.toBe(second.items[0]?.id)
  })

  it('rejects an inverted history date range', async () => {
    const admin = await createProfiledUser(db, 'admin')
    await expect(
      khRewardHistory(deps, await actorOf(db, admin.id), {
        dateFrom: '2026-11-27',
        dateTo: '2026-11-26',
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' })
  })
})
