import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppDeps } from '../../supabase/functions/_shared/app.ts'
import {
  GUEST,
  type Actor,
} from '../../supabase/functions/_shared/auth/actor.ts'
import type { AccessRole } from '../../supabase/functions/_shared/contracts/account.ts'
import {
  moscowToUtc,
  utcToMoscow,
} from '../../supabase/functions/_shared/contracts/moscow-time.ts'
import {
  createEvent,
  deleteEvent,
  deleteTemplate,
  ensureWeeklyEvents,
  getEvent,
  listEvents,
  listTemplates,
  respondToEvent,
  saveTemplate,
  templateNextDate,
  updateEvent,
} from '../../supabase/functions/_shared/events/service.ts'
import {
  actorOf,
  createAuthUser,
  createProfiledUser,
  resetAppData,
  testDb,
  testDeps,
} from './support.ts'

const db = testDb()
// Время сервера фиксировано: четверг 12.11.2026 12:00 МСК.
let now = moscowToUtc('2026-11-12', '12:00')
const deps: AppDeps = {
  ...testDeps(db),
  now: () => now,
  cronSecret: 'test-cron-secret',
}

beforeEach(async () => {
  now = moscowToUtc('2026-11-12', '12:00')
  await resetAppData(db)
})
afterAll(() => db.destroy())

const rejects = (promise: Promise<unknown>, code: string) =>
  expect(promise).rejects.toMatchObject({ code })

async function roleActor(role: AccessRole) {
  const user = await createProfiledUser(db, role)
  return { user, actor: await actorOf(db, user.id) }
}

const fields = (overrides: Record<string, unknown> = {}) => ({
  title: 'Рейд',
  type: 'pve',
  date: '2026-11-14',
  time: '20:00',
  description: 'Собираемся у портала',
  ...overrides,
})

async function auditActions() {
  const rows = await db
    .selectFrom('app.audit_log')
    .select(['action', 'actor_id'])
    .orderBy('id')
    .execute()
  return rows.map((row) => row.action)
}

async function eventCount() {
  const row = await db
    .selectFrom('app.events')
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .executeTakeFirstOrThrow()
  return Number(row.count)
}

describe('access matrix', () => {
  it('rejects a guest, a user without a profile and outsiders', async () => {
    const { actor: officer } = await roleActor('officer')
    const event = await createEvent(deps, officer, fields())
    const template = (await saveTemplate(deps, officer, fields())).items[0]!
    const calls = (actor: Actor) => [
      listEvents(deps, actor, { tab: 'active' }),
      getEvent(deps, actor, { id: event.id }),
      respondToEvent(deps, actor, { eventId: event.id, answer: 'yes' }),
      createEvent(deps, actor, fields()),
      updateEvent(deps, actor, { id: event.id, ...fields() }),
      deleteEvent(deps, actor, { id: event.id }),
      ensureWeeklyEvents(deps, actor, null),
      listTemplates(deps, actor),
      saveTemplate(deps, actor, fields()),
      deleteTemplate(deps, actor, { id: template.id }),
      templateNextDate(deps, actor, { id: template.id }),
    ]
    for (const call of calls(GUEST)) {
      await rejects(call, 'not_authenticated')
    }
    const incomplete = await actorOf(db, (await createAuthUser()).id)
    for (const call of calls(incomplete)) {
      await rejects(call, 'registration_incomplete')
    }
    // Кандидат и чтец не видят событий (ACL-02, ACL-06).
    for (const role of ['applicant', 'reader'] as const) {
      const { actor } = await roleActor(role)
      for (const call of calls(actor)) {
        await rejects(call, 'forbidden')
      }
    }
    expect(await eventCount()).toBe(1)
  })

  it('lets members read and answer but not manage', async () => {
    const { actor: officer } = await roleActor('officer')
    const { actor: member } = await roleActor('member')
    const event = await createEvent(deps, officer, fields())
    await rejects(createEvent(deps, member, fields()), 'forbidden')
    await rejects(
      updateEvent(deps, member, { id: event.id, ...fields() }),
      'forbidden',
    )
    await rejects(deleteEvent(deps, member, { id: event.id }), 'forbidden')
    await rejects(ensureWeeklyEvents(deps, member, null), 'forbidden')
    await rejects(listTemplates(deps, member), 'forbidden')
    const card = await respondToEvent(deps, member, {
      eventId: event.id,
      answer: 'maybe',
    })
    expect(card).toMatchObject({
      myAnswer: 'maybe',
      canManage: false,
      counts: { yes: 0, maybe: 1, no: 0 },
    })
  })

  it('applies authorship: own and recurring for officers, any for admins (ACL-04, Q-47)', async () => {
    const { actor: author } = await roleActor('officer')
    const { actor: other } = await roleActor('officer')
    const { actor: admin } = await roleActor('admin')
    const event = await createEvent(deps, author, fields())
    expect((await getEvent(deps, author, { id: event.id })).canManage).toBe(
      true,
    )
    expect((await getEvent(deps, other, { id: event.id })).canManage).toBe(
      false,
    )
    await rejects(
      updateEvent(deps, other, { id: event.id, ...fields({ title: 'X' }) }),
      'forbidden',
    )
    await rejects(deleteEvent(deps, other, { id: event.id }), 'forbidden')
    await expect(
      updateEvent(deps, admin, { id: event.id, ...fields({ title: 'Админ' }) }),
    ).resolves.toMatchObject({ title: 'Админ' })

    const weekly = await ensureWeeklyEvents(deps, author, null)
    const recurringId = weekly.created[0]!.eventId
    const recurring = await getEvent(deps, other, { id: recurringId })
    expect(recurring).toMatchObject({
      recurring: true,
      createdBy: null,
      canManage: true,
    })
    await expect(
      updateEvent(deps, other, {
        id: recurringId,
        ...fields({ title: 'МТВ+' }),
      }),
    ).resolves.toMatchObject({ title: 'МТВ+' })
    await expect(
      deleteEvent(deps, other, { id: recurringId }),
    ).resolves.toEqual({ deleted: true })
  })

  it('leaves an event of a deleted author to admins only', async () => {
    const { user, actor: author } = await roleActor('officer')
    const { actor: other } = await roleActor('officer')
    const { actor: admin } = await roleActor('admin')
    const event = await createEvent(deps, author, fields())
    await db.deleteFrom('app.profiles').where('id', '=', user.id).execute()
    const card = await getEvent(deps, admin, { id: event.id })
    expect(card).toMatchObject({ createdBy: null, recurring: false })
    await rejects(deleteEvent(deps, other, { id: event.id }), 'forbidden')
    await expect(deleteEvent(deps, admin, { id: event.id })).resolves.toEqual({
      deleted: true,
    })
  })
})

describe('events (EVT-01, EVT-03)', () => {
  it('stores Moscow time and returns it the same way (Q-44)', async () => {
    const { user, actor } = await roleActor('officer')
    const event = await createEvent(
      deps,
      actor,
      fields({ date: '2026-11-14', time: '23:30', title: '  Рейд  ' }),
    )
    expect(event).toMatchObject({
      title: 'Рейд',
      type: 'pve',
      startsAt: '2026-11-14T20:30:00.000Z',
      dateMsk: '2026-11-14',
      timeMsk: '23:30',
      recurring: false,
      createdBy: { gameNickname: user.nickname },
      canAnswer: true,
      canManage: true,
      counts: { yes: 0, maybe: 0, no: 0 },
      myAnswer: null,
    })
    expect(await auditActions()).toEqual(['event_created'])
  })

  it('validates required fields and limits', async () => {
    const { actor } = await roleActor('admin')
    await expect(
      createEvent(deps, actor, fields({ title: ' ', description: '' })),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      fields: { title: 'required', description: 'required' },
    })
    await expect(
      createEvent(deps, actor, fields({ title: 'x'.repeat(81) })),
    ).rejects.toMatchObject({ fields: { title: 'too_long' } })
    await expect(
      createEvent(deps, actor, fields({ date: '2026-02-30', time: '24:00' })),
    ).rejects.toMatchObject({ fields: { date: 'invalid', time: 'invalid' } })
    await expect(
      createEvent(deps, actor, fields({ type: 'raid' })),
    ).rejects.toMatchObject({ fields: { type: 'required' } })
    expect(await eventCount()).toBe(0)
    expect(await auditActions()).toEqual([])
  })

  it('lists active events by start time with counts', async () => {
    const { actor } = await roleActor('officer')
    const later = await createEvent(deps, actor, fields({ date: '2026-11-20' }))
    const sooner = await createEvent(
      deps,
      actor,
      fields({ date: '2026-11-13' }),
    )
    const list = await listEvents(deps, actor, { tab: 'active' })
    expect(list.items.map((item) => item.id)).toEqual([sooner.id, later.id])
    expect(list).toMatchObject({
      activeCount: 2,
      pastCount: 0,
      truncated: false,
      nextCursor: null,
    })
    expect((await listEvents(deps, actor, { tab: 'past' })).items).toHaveLength(
      0,
    )
  })

  it('keeps answers when the event is edited (acceptance 1)', async () => {
    const { actor: officer } = await roleActor('officer')
    const { actor: member } = await roleActor('member')
    const event = await createEvent(deps, officer, fields())
    await respondToEvent(deps, member, { eventId: event.id, answer: 'yes' })
    const edited = await updateEvent(deps, officer, {
      id: event.id,
      ...fields({ description: 'Новое описание' }),
    })
    expect(edited).toMatchObject({
      id: event.id,
      description: 'Новое описание',
      counts: { yes: 1, maybe: 0, no: 0 },
    })
    expect(await auditActions()).toEqual(['event_created', 'event_updated'])
  })

  it('deletes an event with its answers (EVT-10)', async () => {
    const { actor: officer } = await roleActor('officer')
    const { actor: member } = await roleActor('member')
    const event = await createEvent(deps, officer, fields())
    await respondToEvent(deps, member, { eventId: event.id, answer: 'yes' })
    await deleteEvent(deps, officer, { id: event.id })
    const answers = await db
      .selectFrom('app.event_attendance')
      .select('user_id')
      .where('event_id', '=', event.id)
      .execute()
    expect(answers).toEqual([])
    await rejects(getEvent(deps, member, { id: event.id }), 'not_found')
    await rejects(
      respondToEvent(deps, member, { eventId: event.id, answer: 'no' }),
      'not_found',
    )
    expect(await auditActions()).toEqual(['event_created', 'event_deleted'])
  })

  it('rejects changes of a closed event (ACL-05)', async () => {
    const { actor: admin } = await roleActor('admin')
    const event = await createEvent(deps, admin, fields())
    await db
      .updateTable('app.events')
      .set({ closed_at: now.toISOString() })
      .where('id', '=', event.id)
      .execute()
    await expect(
      respondToEvent(deps, admin, { eventId: event.id, answer: 'yes' }),
    ).rejects.toMatchObject({
      code: 'state_conflict',
      fields: { reason: 'closed' },
    })
    await rejects(
      updateEvent(deps, admin, { id: event.id, ...fields() }),
      'state_conflict',
    )
    await rejects(deleteEvent(deps, admin, { id: event.id }), 'state_conflict')
    const past = await listEvents(deps, admin, { tab: 'past' })
    expect(past.items).toHaveLength(1)
    expect(past.items[0]).toMatchObject({ canAnswer: false, canManage: false })
    expect(past.pastCount).toBe(1)
  })
})

describe('answers (EVT-04, EVT-05, Q-43, Q-45)', () => {
  it('changes the one answer instead of adding a second (acceptance 2)', async () => {
    const { actor: officer } = await roleActor('officer')
    const { actor: member } = await roleActor('member')
    const event = await createEvent(deps, officer, fields())
    await respondToEvent(deps, officer, { eventId: event.id, answer: 'yes' })
    await respondToEvent(deps, member, { eventId: event.id, answer: 'yes' })
    const changed = await respondToEvent(deps, member, {
      eventId: event.id,
      answer: 'maybe',
    })
    expect(changed.counts).toEqual({ yes: 1, maybe: 1, no: 0 })
    expect(changed.myAnswer).toBe('maybe')
    const rows = await db
      .selectFrom('app.event_attendance')
      .select('user_id')
      .where('event_id', '=', event.id)
      .execute()
    expect(rows).toHaveLength(2)
    // Ответы в аудит не пишутся (Q-45).
    expect(await auditActions()).toEqual(['event_created'])
  })

  it('accepts answers only before the start (Q-43)', async () => {
    const { actor: officer } = await roleActor('officer')
    const { actor: member } = await roleActor('member')
    const event = await createEvent(
      deps,
      officer,
      fields({ date: '2026-11-12', time: '12:30' }),
    )
    await respondToEvent(deps, member, { eventId: event.id, answer: 'yes' })
    now = moscowToUtc('2026-11-12', '12:30')
    await expect(
      respondToEvent(deps, member, { eventId: event.id, answer: 'no' }),
    ).rejects.toMatchObject({
      code: 'state_conflict',
      fields: { reason: 'started' },
    })
    const card = await getEvent(deps, member, { id: event.id })
    expect(card).toMatchObject({ canAnswer: false, myAnswer: 'yes' })
    // Событие остаётся актуальным до закрытия (EVT-02), правка разрешена.
    expect(card.closedAt).toBeNull()
    await expect(
      updateEvent(deps, officer, {
        id: event.id,
        ...fields({ date: '2026-11-13', time: '20:00' }),
      }),
    ).resolves.toMatchObject({ canAnswer: true })
  })

  it('rejects an unknown answer', async () => {
    const { actor } = await roleActor('member')
    await expect(
      respondToEvent(deps, actor, {
        eventId: crypto.randomUUID(),
        answer: 'later',
      }),
    ).rejects.toMatchObject({ fields: { answer: 'invalid' } })
  })

  it('does not lose answers sent in parallel', async () => {
    const { actor: officer } = await roleActor('officer')
    const event = await createEvent(deps, officer, fields())
    const members = await Promise.all(
      Array.from({ length: 5 }, () => roleActor('member')),
    )
    await Promise.all(
      members.map(({ actor }) =>
        respondToEvent(deps, actor, { eventId: event.id, answer: 'yes' }),
      ),
    )
    expect((await getEvent(deps, officer, { id: event.id })).counts.yes).toBe(5)
  })

  it('shows participants without private fields, readers who answered included', async () => {
    const { actor: officer, user: officerUser } = await roleActor('officer')
    const { user: memberUser } = await roleActor('member')
    const { user: readerUser, actor: readerWhileMember } =
      await roleActor('member')
    const { user: applicant } = await roleActor('applicant')
    const event = await createEvent(deps, officer, fields())
    await respondToEvent(deps, readerWhileMember, {
      eventId: event.id,
      answer: 'no',
    })
    await db
      .updateTable('app.profiles')
      .set({ access_role: 'reader' })
      .where('id', '=', readerUser.id)
      .execute()
    const card = await getEvent(deps, officer, { id: event.id })
    const ids = card.participants.map((person) => person.id)
    expect(ids).toContain(officerUser.id)
    expect(ids).toContain(memberUser.id)
    expect(ids).toContain(readerUser.id)
    expect(ids).not.toContain(applicant.id)
    expect(card.participants[0]).toMatchObject({
      id: readerUser.id,
      answer: 'no',
    })
    expect(Object.keys(card.participants[0]!).sort()).toEqual([
      'answer',
      'avatarUrl',
      'className',
      'gameNickname',
      'id',
    ])
    expect(card.participantsTruncated).toBe(false)
  })
})

describe('recurring events (EVT-14, Q-42, Q-47)', () => {
  it('creates the four nearest issues once', async () => {
    const { actor } = await roleActor('officer')
    // Понедельник 16.11.2026 00:00 МСК — время расписания.
    now = moscowToUtc('2026-11-16', '00:00')
    const first = await ensureWeeklyEvents(deps, GUEST, 'test-cron-secret')
    expect(first.existing).toEqual([])
    expect(
      first.created.map((item) => {
        const msk = utcToMoscow(item.startsAt)
        return `${item.preset} ${msk.date} ${msk.time}`
      }),
    ).toEqual([
      'mtv_sat_20 2026-11-21 20:00',
      'sadik_sat_22 2026-11-21 22:00',
      'tv_sun_20 2026-11-22 20:00',
      'tv_sun_22 2026-11-22 22:00',
    ])
    const again = await ensureWeeklyEvents(deps, actor, null)
    expect(again.created).toEqual([])
    expect(again.existing).toHaveLength(4)
    expect(await eventCount()).toBe(4)
    const list = await listEvents(deps, actor, { tab: 'active' })
    expect(list.items[0]).toMatchObject({
      title: 'МТВ',
      type: 'clan',
      recurring: true,
      createdBy: null,
    })
    const audit = await db
      .selectFrom('app.audit_log')
      .select(['action', 'actor_id'])
      .execute()
    // Один аудит — только за выпуск, создавший события; исполнитель — система.
    expect(audit).toEqual([
      { action: 'recurring_events_created', actor_id: null },
    ])
  })

  it('does not duplicate when the schedule and the button race', async () => {
    const { actor } = await roleActor('admin')
    const results = await Promise.allSettled([
      ensureWeeklyEvents(deps, GUEST, 'test-cron-secret'),
      ensureWeeklyEvents(deps, actor, null),
      ensureWeeklyEvents(deps, actor, null),
    ])
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true)
    expect(await eventCount()).toBe(4)
  })

  it('recreates only a deleted issue', async () => {
    const { actor } = await roleActor('officer')
    const first = await ensureWeeklyEvents(deps, actor, null)
    await deleteEvent(deps, actor, { id: first.created[1]!.eventId })
    const again = await ensureWeeklyEvents(deps, actor, null)
    expect(again.created.map((item) => item.preset)).toEqual(['sadik_sat_22'])
    expect(await eventCount()).toBe(4)
  })

  it('rejects a wrong or unconfigured schedule secret', async () => {
    await rejects(ensureWeeklyEvents(deps, GUEST, 'wrong'), 'forbidden')
    await rejects(
      ensureWeeklyEvents({ ...deps, cronSecret: null }, GUEST, 'anything'),
      'forbidden',
    )
    expect(await eventCount()).toBe(0)
  })
})

describe('templates (EVT-11–13, Q-46)', () => {
  it('saves a template without creating an event (acceptance 3)', async () => {
    const { user, actor } = await roleActor('officer')
    const result = await saveTemplate(
      deps,
      actor,
      fields({ date: '2026-11-15', time: '21:00', type: 'pvp' }),
    )
    expect(result.items).toEqual([
      {
        id: expect.any(String),
        title: 'Рейд',
        type: 'pvp',
        description: 'Собираемся у портала',
        weekday: 0,
        time: '21:00',
        createdBy: { gameNickname: user.nickname },
      },
    ])
    expect(await eventCount()).toBe(0)
    expect(await auditActions()).toEqual(['event_template_created'])
  })

  it('gives next week when the time today has passed (EVT-12)', async () => {
    const { actor } = await roleActor('officer')
    // Шаблон на четверг 10:00; сейчас четверг 12:00 МСК.
    const { items } = await saveTemplate(
      deps,
      actor,
      fields({ date: '2026-11-12', time: '10:00' }),
    )
    expect(await templateNextDate(deps, actor, { id: items[0]!.id })).toEqual({
      date: '2026-11-19',
      time: '10:00',
    })
    const later = await saveTemplate(
      deps,
      actor,
      fields({ date: '2026-11-12', time: '18:00' }),
    )
    const lateId = later.items.find((item) => item.time === '18:00')!.id
    expect(await templateNextDate(deps, actor, { id: lateId })).toEqual({
      date: '2026-11-12',
      time: '18:00',
    })
  })

  it('shares the library between officers and admins', async () => {
    const { actor: author } = await roleActor('officer')
    const { actor: other } = await roleActor('officer')
    const { items } = await saveTemplate(deps, author, fields())
    expect((await listTemplates(deps, other)).items).toHaveLength(1)
    await expect(
      deleteTemplate(deps, other, { id: items[0]!.id }),
    ).resolves.toEqual({ items: [] })
    await rejects(
      deleteTemplate(deps, other, { id: items[0]!.id }),
      'not_found',
    )
    expect(await auditActions()).toEqual([
      'event_template_created',
      'event_template_deleted',
    ])
  })

  it('keeps at most 50 templates', async () => {
    const { user, actor } = await roleActor('admin')
    await db
      .insertInto('app.event_templates')
      .values(
        Array.from({ length: 50 }, (_, index) => ({
          title: `Шаблон ${index}`,
          event_type: 'clan',
          description: 'Описание',
          weekday: 1,
          time_msk: '20:00',
          created_by: user.id,
        })),
      )
      .execute()
    await expect(saveTemplate(deps, actor, fields())).rejects.toMatchObject({
      code: 'validation_failed',
      fields: { limit: 'too_many' },
    })
  })
})
