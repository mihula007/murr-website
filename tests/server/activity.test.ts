import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  activityEvent,
  activityEvents,
  activityHistory,
  activityMember,
  activitySummary,
  attendanceRating,
  monthTop,
} from '../../supabase/functions/_shared/activity/service.ts'
import type { AppDeps } from '../../supabase/functions/_shared/app.ts'
import {
  GUEST,
  type Actor,
} from '../../supabase/functions/_shared/auth/actor.ts'
import type { AccessRole } from '../../supabase/functions/_shared/contracts/account.ts'
import { moscowToUtc } from '../../supabase/functions/_shared/contracts/moscow-time.ts'
import {
  closeEvent,
  createEvent,
  respondToEvent,
} from '../../supabase/functions/_shared/events/service.ts'
import {
  createGroup,
  moveMember,
  setGroupLeader,
} from '../../supabase/functions/_shared/groups/service.ts'
import {
  actorOf,
  createAuthUser,
  createProfiledUser,
  resetAppData,
  testDb,
  testDeps,
} from './support.ts'

const db = testDb()
// Четверг 12.11.2026 12:00 МСК.
let now = moscowToUtc('2026-11-12', '12:00')
const deps: AppDeps = { ...testDeps(db), now: () => now }

beforeEach(async () => {
  now = moscowToUtc('2026-11-12', '12:00')
  await resetAppData(db)
})
afterAll(() => db.destroy())

const rejects = (promise: Promise<unknown>, code: string) =>
  expect(promise).rejects.toMatchObject({ code })

async function roleActor(role: AccessRole, nickname?: string) {
  const user = await createProfiledUser(db, role)
  if (nickname) {
    await db
      .updateTable('app.profiles')
      .set({ game_nickname: nickname })
      .where('id', '=', user.id)
      .execute()
  }
  return { user, actor: await actorOf(db, user.id) }
}

type Person = Awaited<ReturnType<typeof roleActor>>

/**
 * Событие с датой начала МСК: `visit` — в группе (первый — лидер),
 * `answer` — ответили «Приду» вне группы. Остальные — без ответа.
 */
async function closedEvent(
  officer: Person,
  date: string,
  { visit = [], answer = [] }: { visit?: Person[]; answer?: Person[] },
  title = 'Рейд',
) {
  const event = await createEvent(deps, officer.actor, {
    title,
    type: 'pve',
    date,
    time: '20:00',
    description: 'Описание',
  })
  // Ответы принимаются до начала: время сервера сдвигается назад.
  const saved = now
  now = moscowToUtc(date, '00:00')
  for (const person of answer) {
    await respondToEvent(deps, person.actor, {
      eventId: event.id,
      answer: 'yes',
    })
  }
  now = saved
  if (visit.length > 0) {
    const { groups } = await createGroup(deps, officer.actor, {
      eventId: event.id,
      name: 'Пати',
    })
    for (const person of visit) {
      await moveMember(deps, officer.actor, {
        eventId: event.id,
        userId: person.user.id,
        groupId: groups[0]!.id,
      })
    }
    await setGroupLeader(deps, officer.actor, {
      groupId: groups[0]!.id,
      userId: visit[0]!.user.id,
    })
  }
  await closeEvent(deps, officer.actor, { id: event.id })
  return event
}

describe('activity: access (01-roles, Q-25)', () => {
  it('opens the tracking to officers and admins, the rating to all members', async () => {
    const incomplete = await actorOf(db, (await createAuthUser()).id)
    const member = await roleActor('member')
    const event = await closedEvent(
      await roleActor('officer'),
      '2026-11-01',
      {},
    )
    const outsiders: [Actor, string][] = [
      [GUEST, 'not_authenticated'],
      [incomplete, 'registration_incomplete'],
      [(await roleActor('applicant')).actor, 'forbidden'],
      [(await roleActor('reader')).actor, 'forbidden'],
    ]
    for (const [actor, code] of [
      ...outsiders,
      [member.actor, 'forbidden'] as [Actor, string],
    ]) {
      await rejects(activitySummary(deps, actor, {}), code)
      await rejects(activityHistory(deps, actor, {}), code)
      await rejects(activityEvents(deps, actor, {}), code)
      await rejects(activityEvent(deps, actor, { eventId: event.id }), code)
      await rejects(
        activityMember(deps, actor, { userId: member.user.id }),
        code,
      )
    }
    for (const [actor, code] of outsiders) {
      await rejects(attendanceRating(deps, actor), code)
      await rejects(monthTop(deps, actor), code)
    }
    expect((await attendanceRating(deps, member.actor)).eventCount).toBe(1)
    expect((await monthTop(deps, member.actor)).eventCount).toBe(1)
  })
})

describe('activity: summary and rating (ACT-04, ACT-05, ACT-14–16)', () => {
  it('counts statuses, percent per own records and leaders only in the rating', async () => {
    const officer = await roleActor('officer', 'Офицер')
    const a = await roleActor('member', 'Анна')
    const b = await roleActor('member', 'Борис')
    await closedEvent(officer, '2026-11-01', { visit: [a, b] })
    await closedEvent(officer, '2026-11-02', { visit: [a], answer: [b] })
    // Вступивший позже имеет записи только с третьего события (Q-49).
    const c = await roleActor('member', 'Вера')
    await closedEvent(officer, '2026-11-03', { visit: [c], answer: [a] })

    const summary = await activitySummary(deps, officer.actor, {})
    expect(summary.eventCount).toBe(3)
    const byName = Object.fromEntries(
      summary.items.map((row) => [row.gameNickname, row]),
    )
    expect(byName['Анна']).toMatchObject({
      visited: 2,
      missed: 1,
      unmarked: 0,
      percent: 67,
    })
    expect(byName['Борис']).toMatchObject({
      visited: 1,
      missed: 1,
      unmarked: 1,
      percent: 33,
    })
    expect(byName['Вера']).toMatchObject({ visited: 1, percent: 100 })
    expect(byName['Офицер']).toMatchObject({ unmarked: 3, percent: 0 })
    expect(Object.keys(byName['Анна']!)).not.toContain('leaderCount')
    expect(summary.items.map((row) => row.gameNickname)).toEqual([
      'Анна',
      'Вера',
      'Борис',
      'Офицер',
    ])

    await db
      .updateTable('app.profiles')
      .set({ joined_on: '2026-11-02' })
      .where('id', '=', a.user.id)
      .execute()
    const rating = await attendanceRating(deps, a.actor)
    const anna = rating.items.find((row) => row.userId === a.user.id)
    expect(anna).toMatchObject({ leaderCount: 2, percent: 67, daysInGuild: 10 })
    const vera = rating.items.find((row) => row.userId === c.user.id)
    expect(vera).toMatchObject({ leaderCount: 1, percent: 100 })
  })

  it('filters by period on the Moscow start date and by class (ACT-09, Q-50)', async () => {
    const officer = await roleActor('officer')
    const a = await roleActor('member', 'Анна')
    // 23:30 МСК 31 октября = 20:30 UTC: событие относится к октябрю.
    const event = await createEvent(deps, officer.actor, {
      title: 'Поздний',
      type: 'pve',
      date: '2026-10-31',
      time: '23:30',
      description: 'Описание',
    })
    const { groups } = await createGroup(deps, officer.actor, {
      eventId: event.id,
      name: 'Пати',
    })
    await moveMember(deps, officer.actor, {
      eventId: event.id,
      userId: a.user.id,
      groupId: groups[0]!.id,
    })
    await closeEvent(deps, officer.actor, { id: event.id })
    await closedEvent(officer, '2026-11-01', {})

    const october = await activitySummary(deps, officer.actor, {
      from: '2026-10-31',
      to: '2026-10-31',
    })
    expect(october.eventCount).toBe(1)
    expect(october.items.find((row) => row.userId === a.user.id)?.visited).toBe(
      1,
    )
    const november = await activitySummary(deps, officer.actor, {
      from: '2026-11-01',
    })
    expect(november.eventCount).toBe(1)
    expect(
      november.items.find((row) => row.userId === a.user.id)?.visited,
    ).toBe(0)

    await db
      .updateTable('app.profiles')
      .set({ class_id: 2 })
      .where('id', '=', a.user.id)
      .execute()
    const mages = await activitySummary(deps, officer.actor, { classId: 2 })
    expect(mages.items.map((row) => row.userId)).toEqual([a.user.id])

    await rejects(
      activitySummary(deps, officer.actor, {
        from: '2026-11-02',
        to: '2026-11-01',
      }),
      'validation_failed',
    )
  })

  it('keeps readers in history and summary but not in the rating (Q-53, ACT-17)', async () => {
    const officer = await roleActor('officer')
    const a = await roleActor('member', 'Анна')
    const gone = await roleActor('member', 'Удалён')
    await closedEvent(officer, '2026-11-01', { visit: [a, gone] })
    await db
      .updateTable('app.profiles')
      .set({ access_role: 'reader' })
      .where('id', '=', a.user.id)
      .execute()

    const summary = await activitySummary(deps, officer.actor, {})
    expect(summary.items.find((row) => row.userId === a.user.id)).toMatchObject(
      { isReader: true, visited: 1 },
    )
    const rating = await attendanceRating(deps, officer.actor)
    expect(rating.items.some((row) => row.userId === a.user.id)).toBe(false)
    const history = await activityHistory(deps, officer.actor, {})
    expect(
      history.items.find((row) => row.userId === a.user.id)?.isReader,
    ).toBe(true)

    // Удалённый пользователь исчезает из истории и показателей (ACT-17).
    await db.deleteFrom('app.profiles').where('id', '=', gone.user.id).execute()
    const after = await activityHistory(deps, officer.actor, {})
    expect(after.items.some((row) => row.userId === gone.user.id)).toBe(false)
    const event = await activityEvent(deps, officer.actor, {
      eventId: after.items[0]!.eventId,
    })
    expect(event.counts.visited).toBe(1)
  })
})

describe('activity: history, events and member (ACT-06–08)', () => {
  it('pages history by cursor without gaps, newest events first, with search', async () => {
    const officer = await roleActor('officer', 'Офицер')
    const a = await roleActor('member', 'Анна')
    const b = await roleActor('member', 'Борис')
    await closedEvent(officer, '2026-11-01', { visit: [a] }, 'Рейд')
    await closedEvent(officer, '2026-11-02', { visit: [b] }, 'Осада')

    const seen: string[] = []
    let cursor: string | null = null
    do {
      const page: Awaited<ReturnType<typeof activityHistory>> =
        await activityHistory(deps, officer.actor, { cursor, limit: 2 })
      seen.push(
        ...page.items.map((row) => `${row.eventTitle}:${row.gameNickname}`),
      )
      cursor = page.nextCursor
    } while (cursor)
    expect(seen).toEqual([
      'Осада:Анна',
      'Осада:Борис',
      'Осада:Офицер',
      'Рейд:Анна',
      'Рейд:Борис',
      'Рейд:Офицер',
    ])

    const search = await activityHistory(deps, officer.actor, {
      search: 'осад',
    })
    expect(search.items).toHaveLength(3)
    const byNick = await activityHistory(deps, officer.actor, {
      search: 'Борис',
    })
    expect(byNick.items.map((row) => row.status)).toEqual([
      'visited',
      'unmarked',
    ])
    expect(byNick.items[0]).toMatchObject({
      groupName: 'Пати',
      isLeader: true,
      dateMsk: '2026-11-02',
    })
    expect(byNick.items[1]!.groupName).toBeNull()
    await rejects(
      activityHistory(deps, officer.actor, { cursor: 'bad' }),
      'validation_failed',
    )
  })

  it('lists closed events and shows one event and one member', async () => {
    const officer = await roleActor('officer')
    const a = await roleActor('member')
    const b = await roleActor('member')
    const first = await closedEvent(officer, '2026-11-01', {
      visit: [a],
      answer: [b],
    })
    await closedEvent(officer, '2026-11-02', { answer: [a] })
    // Незакрытое событие в выбор не попадает.
    await createEvent(deps, officer.actor, {
      title: 'Будущее',
      type: 'pvp',
      date: '2026-11-20',
      time: '20:00',
      description: 'Описание',
    })

    const events = await activityEvents(deps, officer.actor, {})
    expect(events.items.map((row) => row.dateMsk)).toEqual([
      '2026-11-02',
      '2026-11-01',
    ])

    const one = await activityEvent(deps, officer.actor, { eventId: first.id })
    expect(one.counts).toEqual({ visited: 1, missed: 1, unmarked: 1, total: 3 })
    expect(one.rows[0]).toMatchObject({ userId: a.user.id, groupName: 'Пати' })
    await rejects(
      activityEvent(deps, officer.actor, {
        eventId: (
          await createEvent(deps, officer.actor, {
            title: 'Открытое',
            type: 'pvp',
            date: '2026-11-20',
            time: '20:00',
            description: 'Описание',
          })
        ).id,
      }),
      'not_found',
    )

    const member = await activityMember(deps, officer.actor, {
      userId: a.user.id,
    })
    expect(member.stats).toEqual({
      visited: 1,
      missed: 1,
      unmarked: 0,
      total: 2,
      percent: 50,
    })
    expect(member.items.map((row) => row.status)).toEqual(['missed', 'visited'])
    expect(member.nextCursor).toBeNull()
  })
})

describe('activity/month-top (ACT-12, ACT-13)', () => {
  it('ranks current members of the Moscow month with at least one visit', async () => {
    const officer = await roleActor('officer')
    const people = await Promise.all(
      ['Анна', 'Борис', 'Вера', 'Глеб', 'Дина', 'Егор', 'Жора'].map((name) =>
        roleActor('member', name),
      ),
    )
    const [anna, boris, vera, gleb, dina, egor, zhora] = people
    // Октябрь не учитывается.
    await closedEvent(officer, '2026-10-30', { visit: [zhora!] })
    await closedEvent(officer, '2026-11-01', {
      visit: [anna!, boris!, vera!, gleb!, dina!, egor!],
    })
    await closedEvent(officer, '2026-11-02', { visit: [boris!, anna!] })

    const top = await monthTop(deps, officer.actor)
    expect(top.month).toBe('2026-11')
    expect(top.eventCount).toBe(2)
    expect(top.items.map((row) => row.gameNickname)).toEqual([
      'Анна',
      'Борис',
      'Вера',
      'Глеб',
      'Дина',
    ])
    expect(top.items[1]).toMatchObject({ visited: 2, total: 2, leaderCount: 1 })
  })

  it('is empty without closed events of the month', async () => {
    const member = await roleActor('member')
    const top = await monthTop(deps, member.actor)
    expect(top).toEqual({ month: '2026-11', eventCount: 0, items: [] })
  })
})
