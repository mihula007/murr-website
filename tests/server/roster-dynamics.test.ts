import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { GUEST } from '../../supabase/functions/_shared/auth/actor.ts'
import type { AccessRole } from '../../supabase/functions/_shared/contracts/account.ts'
import {
  dynamicsAttendance,
  dynamicsProfile,
  dynamicsStats,
  recordWeeklyDynamicsCheckpoint,
} from '../../supabase/functions/_shared/roster/dynamics-service.ts'
import {
  actorOf,
  createProfiledUser,
  resetAppData,
  testDb,
  testDeps,
} from './support.ts'

const db = testDb()
const deps = testDeps(db)
beforeEach(() => resetAppData(db))
afterAll(() => db.destroy())

async function actorFor(role: AccessRole) {
  const user = await createProfiledUser(db, role)
  return { user, actor: await actorOf(db, user.id) }
}

describe('roster dynamics', () => {
  it('records one idempotent Friday checkpoint for every current member only via cron secret', async () => {
    const target = await actorFor('member')
    const applicant = await actorFor('applicant')
    await db
      .updateTable('app.profiles')
      .set({ pa: 100, pz: 200, bu: 30, hp: 40000, bd: 5000 })
      .where('id', '=', target.user.id)
      .execute()
    await db
      .updateTable('app.profiles')
      .set({ pa: 999, pz: 999, bu: 999, hp: 999, bd: 999 })
      .where('id', '=', applicant.user.id)
      .execute()
    const fridayDeps = {
      ...deps,
      cronSecret: 'test-cron-secret',
      now: () => new Date('2026-11-27T20:59:30.000Z'),
    }
    await expect(
      recordWeeklyDynamicsCheckpoint(fridayDeps, 'wrong'),
    ).rejects.toMatchObject({ code: 'forbidden' })
    const first = await recordWeeklyDynamicsCheckpoint(
      fridayDeps,
      'test-cron-secret',
    )
    const second = await recordWeeklyDynamicsCheckpoint(
      fridayDeps,
      'test-cron-secret',
    )
    expect(first).toMatchObject({
      recordedAt: '2026-11-27T20:59:00.000Z',
      inserted: 5,
    })
    expect(second).toMatchObject({ inserted: 0 })
    const rows = await db
      .selectFrom('app.character_stat_history')
      .select(['field', 'value', 'recorded_at', 'kind'])
      .where('user_id', '=', target.user.id)
      .orderBy('field')
      .execute()
    expect(rows).toEqual([
      {
        field: 'bd',
        value: '5000.000',
        recorded_at: '2026-11-27 20:59:00+00',
        kind: 'checkpoint',
      },
      {
        field: 'bu',
        value: '30.000',
        recorded_at: '2026-11-27 20:59:00+00',
        kind: 'checkpoint',
      },
      {
        field: 'hp',
        value: '40000.000',
        recorded_at: '2026-11-27 20:59:00+00',
        kind: 'checkpoint',
      },
      {
        field: 'pa',
        value: '100.000',
        recorded_at: '2026-11-27 20:59:00+00',
        kind: 'checkpoint',
      },
      {
        field: 'pz',
        value: '200.000',
        recorded_at: '2026-11-27 20:59:00+00',
        kind: 'checkpoint',
      },
    ])
    await expect(
      db
        .selectFrom('app.character_stat_history')
        .selectAll()
        .where('user_id', '=', applicant.user.id)
        .execute(),
    ).resolves.toEqual([])
    await expect(
      db.selectFrom('app.audit_log').selectAll().execute(),
    ).resolves.toEqual([])
  })

  it('allows only internal roles and only returns internal target headers', async () => {
    const target = await actorFor('member')
    await db
      .updateTable('app.profiles')
      .set({ display_name: 'Мария Мурр', joined_on: '2024-01-02' })
      .where('id', '=', target.user.id)
      .execute()
    for (const role of ['member', 'officer', 'master', 'admin'] as const) {
      const viewer = await actorFor(role)
      expect(
        await dynamicsProfile(deps, viewer.actor, { userId: target.user.id }),
      ).toMatchObject({ displayName: 'Мария Мурр', joinedOn: '2024-01-02' })
      expect(
        await dynamicsStats(deps, viewer.actor, {
          userId: target.user.id,
          fields: ['pa'],
        }),
      ).toHaveProperty('items')
      expect(
        await dynamicsAttendance(deps, viewer.actor, {
          userId: target.user.id,
        }),
      ).toHaveProperty('items')
    }
    await expect(
      dynamicsProfile(deps, GUEST, { userId: target.user.id }),
    ).rejects.toMatchObject({ code: 'not_authenticated' })
    await expect(
      dynamicsStats(deps, GUEST, {
        userId: target.user.id,
        fields: ['pa'],
      }),
    ).rejects.toMatchObject({ code: 'not_authenticated' })
    await expect(
      dynamicsAttendance(deps, GUEST, { userId: target.user.id }),
    ).rejects.toMatchObject({ code: 'not_authenticated' })
    for (const role of ['applicant', 'reader'] as const) {
      const viewer = await actorFor(role)
      await expect(
        dynamicsProfile(deps, viewer.actor, { userId: target.user.id }),
      ).rejects.toMatchObject({ code: 'forbidden' })
      await expect(
        dynamicsStats(deps, viewer.actor, {
          userId: target.user.id,
          fields: ['pa'],
        }),
      ).rejects.toMatchObject({ code: 'forbidden' })
      await expect(
        dynamicsAttendance(deps, viewer.actor, { userId: target.user.id }),
      ).rejects.toMatchObject({ code: 'forbidden' })
      const hidden = await actorFor(role)
      await expect(
        dynamicsProfile(deps, target.actor, { userId: hidden.user.id }),
      ).rejects.toMatchObject({ code: 'not_found' })
    }
  })

  it('returns baseline and Friday checkpoints only in stable cursor pages', async () => {
    const viewer = await actorFor('officer')
    const target = await actorFor('member')
    await db
      .insertInto('app.character_stat_history')
      .values([
        {
          user_id: target.user.id,
          field: 'pa',
          value: 10,
          recorded_at: '2026-10-01T00:00:00Z',
          kind: 'baseline',
        },
        {
          user_id: target.user.id,
          field: 'pa',
          value: 20,
          recorded_at: '2026-10-02T00:00:00Z',
          kind: 'change',
        },
        {
          user_id: target.user.id,
          field: 'pa',
          value: 20,
          recorded_at: '2026-10-02T20:59:00Z',
          kind: 'checkpoint',
        },
        {
          user_id: target.user.id,
          field: 'pz',
          value: 30,
          recorded_at: '2026-10-02T00:00:00Z',
          kind: 'change',
        },
      ])
      .execute()
    const first = await dynamicsStats(deps, viewer.actor, {
      userId: target.user.id,
      fields: ['pa'],
      limit: 1,
      period: 'all',
    })
    expect(first.items.map((item) => item.value)).toEqual([20])
    expect(first.items[0]?.kind).toBe('checkpoint')
    expect(first.nextCursor).toBeTruthy()
    const second = await dynamicsStats(deps, viewer.actor, {
      userId: target.user.id,
      fields: ['pa'],
      limit: 1,
      period: 'all',
      cursor: first.nextCursor,
    })
    expect(second.items.map((item) => item.value)).toEqual([10])
    expect(second.items[0]?.kind).toBe('baseline')
    expect(second.nextCursor).toBeNull()
    expect(
      await dynamicsStats(deps, viewer.actor, {
        userId: target.user.id,
        fields: ['pa'],
        period: '30',
      }),
    ).toEqual({ items: [], nextCursor: null })
  })

  it('does not expose profile details in chart data and limits attendance to closed events', async () => {
    const viewer = await actorFor('member')
    const target = await actorFor('member')
    expect(
      await dynamicsStats(deps, viewer.actor, {
        userId: target.user.id,
        fields: ['pa'],
      }),
    ).not.toHaveProperty('email')
    const attendance = await dynamicsAttendance(deps, viewer.actor, {
      userId: target.user.id,
      period: 'all',
    })
    expect(attendance).toEqual({ items: [], nextCursor: null })
  })

  it('groups the three attendance outcomes by Moscow week and ignores open events', async () => {
    const viewer = await actorFor('officer')
    const target = await actorFor('member')
    const { class_id: classId } = await db
      .selectFrom('app.profiles')
      .select('class_id')
      .where('id', '=', target.user.id)
      .executeTakeFirstOrThrow()
    const rows = [
      { status: 'visited', closed: true, startsAt: '2026-11-24T17:00:00Z' },
      { status: 'missed', closed: true, startsAt: '2026-11-24T17:00:00Z' },
      { status: 'unmarked', closed: true, startsAt: '2026-11-24T17:00:00Z' },
      { status: 'visited', closed: false, startsAt: '2026-11-24T17:00:00Z' },
      { status: 'missed', closed: true, startsAt: '2026-11-17T17:00:00Z' },
    ]
    const events = rows.map(({ closed, startsAt }) => ({
      id: randomUUID(),
      title: 'Ивент',
      event_type: 'clan',
      description: 'Проверка',
      starts_at: startsAt,
      closed_at: closed ? '2026-11-24T20:00:00Z' : null,
    }))
    await db.insertInto('app.events').values(events).execute()
    await db
      .insertInto('app.event_activity_records')
      .values(
        rows.map((row, index) => ({
          event_id: events[index]!.id,
          user_id: target.user.id,
          nickname: target.user.nickname,
          class_id: classId,
          status: row.status,
          group_name: row.status === 'visited' ? 'Пати' : null,
          is_leader: false,
        })),
      )
      .execute()
    const attendance = await dynamicsAttendance(deps, viewer.actor, {
      userId: target.user.id,
      period: 'all',
      limit: 1,
    })
    expect(attendance.items).toEqual([
      { weekStart: '2026-11-23', visited: 1, missed: 1, unmarked: 1 },
    ])
    expect(attendance.nextCursor).toBeTruthy()
    const earlier = await dynamicsAttendance(deps, viewer.actor, {
      userId: target.user.id,
      period: 'all',
      limit: 1,
      cursor: attendance.nextCursor,
    })
    expect(earlier.items).toEqual([
      { weekStart: '2026-11-16', visited: 0, missed: 1, unmarked: 0 },
    ])
  })
})
