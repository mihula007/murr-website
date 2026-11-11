import { afterAll, beforeEach, describe, expect, it } from 'vitest'
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
  deleteEvent,
  getEvent,
  respondToEvent,
  updateEvent,
} from '../../supabase/functions/_shared/events/service.ts'
import {
  applyGroupTemplate,
  createGroup,
  deleteGroup,
  deleteGroupTemplate,
  listGroupTemplates,
  moveMember,
  renameGroup,
  saveGroupTemplate,
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
// Четверг 12.11.2026 12:00 МСК; событие — в субботу.
let now = moscowToUtc('2026-11-12', '12:00')
const deps: AppDeps = { ...testDeps(db), now: () => now }

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

const fields = {
  title: 'Рейд',
  type: 'pve',
  date: '2026-11-14',
  time: '20:00',
  description: 'Собираемся у портала',
}

async function setup() {
  const officer = await roleActor('officer')
  const event = await createEvent(deps, officer.actor, fields)
  const a = await roleActor('member')
  const b = await roleActor('member')
  const c = await roleActor('member')
  return { officer, event, a, b, c }
}

/** Группы события как `{ имя: [userId, …] }` с лидером в конце имени. */
function layout(
  groups: { name: string; members: { userId: string; isLeader: boolean }[] }[],
) {
  return groups.map((group) => ({
    name: group.name,
    members: group.members.map((m) => (m.isLeader ? `${m.userId}*` : m.userId)),
  }))
}

async function auditActions() {
  const rows = await db
    .selectFrom('app.audit_log')
    .select('action')
    .orderBy('id')
    .execute()
  return rows.map((row) => row.action)
}

describe('groups: access (GRP, ACL)', () => {
  it('lets only officers and admins change groups', async () => {
    const { event, a } = await setup()
    const incomplete = await actorOf(db, (await createAuthUser()).id)
    const denied: [Actor, string][] = [
      [GUEST, 'not_authenticated'],
      [incomplete, 'registration_incomplete'],
      [(await roleActor('applicant')).actor, 'forbidden'],
      [(await roleActor('reader')).actor, 'forbidden'],
      [a.actor, 'forbidden'],
    ]
    for (const [actor, code] of denied) {
      await rejects(
        createGroup(deps, actor, { eventId: event.id, name: 'Пати' }),
        code,
      )
      await rejects(
        moveMember(deps, actor, {
          eventId: event.id,
          userId: a.user.id,
          groupId: null,
        }),
        code,
      )
      await rejects(listGroupTemplates(deps, actor), code)
      await rejects(closeEvent(deps, actor, { id: event.id }), code)
    }
    const admin = await roleActor('admin')
    // Группами события управляет любой офицер, не только автор.
    const other = await roleActor('officer')
    await createGroup(deps, other.actor, { eventId: event.id, name: 'Пати' })
    const { groups } = await createGroup(deps, admin.actor, {
      eventId: event.id,
      name: 'Пати 2',
    })
    expect(groups.map((g) => g.name)).toEqual(['Пати', 'Пати 2'])
  })

  it('shows groups and management flags in event details', async () => {
    const { officer, event, a } = await setup()
    await createGroup(deps, officer.actor, { eventId: event.id, name: 'Пати' })
    const asMember = await getEvent(deps, a.actor, { id: event.id })
    expect(asMember.groups).toHaveLength(1)
    expect(asMember.canManageGroups).toBe(false)
    expect(asMember.canClose).toBe(false)
    const asOfficer = await getEvent(deps, officer.actor, { id: event.id })
    expect(asOfficer.canManageGroups).toBe(true)
    expect(asOfficer.canClose).toBe(true)
    const other = await roleActor('officer')
    const asOther = await getEvent(deps, other.actor, { id: event.id })
    expect(asOther.canManageGroups).toBe(true)
    // Закрывает автор-офицер или администратор (EVT-07).
    expect(asOther.canClose).toBe(false)
  })

  it('rejects an empty group name (GRP-03)', async () => {
    const { officer, event } = await setup()
    await rejects(
      createGroup(deps, officer.actor, { eventId: event.id, name: '  ' }),
      'validation_failed',
    )
  })
})

describe('groups: moves, order and leader (GRP-04–09)', () => {
  it('moves a member between groups and back to the pool without duplicates', async () => {
    const { officer, event, a, b } = await setup()
    await respondToEvent(deps, a.actor, { eventId: event.id, answer: 'yes' })
    let { groups } = await createGroup(deps, officer.actor, {
      eventId: event.id,
      name: 'Пати 1',
    })
    ;({ groups } = await createGroup(deps, officer.actor, {
      eventId: event.id,
      name: 'Пати 2',
    }))
    const [g1, g2] = groups
    const move = (userId: string, groupId: string | null, position?: number) =>
      moveMember(deps, officer.actor, {
        eventId: event.id,
        userId,
        groupId,
        position,
      })
    ;({ groups } = await move(a.user.id, g1!.id))
    // Не ответивший тоже назначается (GRP-05).
    ;({ groups } = await move(b.user.id, g1!.id))
    expect(layout(groups)[0]!.members).toEqual([a.user.id, b.user.id])
    ;({ groups } = await move(a.user.id, g2!.id))
    expect(layout(groups)).toEqual([
      { name: 'Пати 1', members: [b.user.id] },
      { name: 'Пати 2', members: [a.user.id] },
    ])
    ;({ groups } = await move(a.user.id, null))
    expect(groups.flatMap((g) => g.members)).toHaveLength(1)
    // Ответ не изменился (GRP-05).
    const details = await getEvent(deps, a.actor, { id: event.id })
    expect(details.myAnswer).toBe('yes')
  })

  it('keeps order inside a group and the leader on reorder (GRP-07)', async () => {
    const { officer, event, a, b, c } = await setup()
    const { groups: created } = await createGroup(deps, officer.actor, {
      eventId: event.id,
      name: 'Пати',
    })
    const groupId = created[0]!.id
    for (const user of [a, b, c]) {
      await moveMember(deps, officer.actor, {
        eventId: event.id,
        userId: user.user.id,
        groupId,
      })
    }
    await setGroupLeader(deps, officer.actor, { groupId, userId: c.user.id })
    // c — на первое место, лидерство сохраняется.
    let { groups } = await moveMember(deps, officer.actor, {
      eventId: event.id,
      userId: c.user.id,
      groupId,
      position: 0,
    })
    expect(layout(groups)[0]!.members).toEqual([
      `${c.user.id}*`,
      a.user.id,
      b.user.id,
    ])
    // a — в конец (позиция больше размера — в конец).
    ;({ groups } = await moveMember(deps, officer.actor, {
      eventId: event.id,
      userId: a.user.id,
      groupId,
      position: 99,
    }))
    expect(layout(groups)[0]!.members).toEqual([
      `${c.user.id}*`,
      b.user.id,
      a.user.id,
    ])
  })

  it('never leaves a leader outside the group (GRP-08)', async () => {
    const { officer, event, a, b } = await setup()
    let { groups } = await createGroup(deps, officer.actor, {
      eventId: event.id,
      name: 'Пати 1',
    })
    ;({ groups } = await createGroup(deps, officer.actor, {
      eventId: event.id,
      name: 'Пати 2',
    }))
    const [g1, g2] = groups
    for (const user of [a, b]) {
      await moveMember(deps, officer.actor, {
        eventId: event.id,
        userId: user.user.id,
        groupId: g1!.id,
      })
    }
    await setGroupLeader(deps, officer.actor, {
      groupId: g1!.id,
      userId: a.user.id,
    })
    // Лидер из другой группы не назначается.
    await rejects(
      setGroupLeader(deps, officer.actor, {
        groupId: g2!.id,
        userId: a.user.id,
      }),
      'validation_failed',
    )
    // Смена лидера снимает прежнего.
    ;({ groups } = await setGroupLeader(deps, officer.actor, {
      groupId: g1!.id,
      userId: b.user.id,
    }))
    expect(layout(groups)[0]!.members).toEqual([a.user.id, `${b.user.id}*`])
    // Перенос лидера в другую группу снимает лидерство; порядок остальных сохранён.
    ;({ groups } = await moveMember(deps, officer.actor, {
      eventId: event.id,
      userId: b.user.id,
      groupId: g2!.id,
    }))
    expect(layout(groups)).toEqual([
      { name: 'Пати 1', members: [a.user.id] },
      { name: 'Пати 2', members: [b.user.id] },
    ])
    ;({ groups } = await setGroupLeader(deps, officer.actor, {
      groupId: g2!.id,
      userId: null,
    }))
    expect(groups[1]!.members[0]!.isLeader).toBe(false)
  })

  it('renames and deletes a group, returning people to the pool (GRP-09)', async () => {
    const { officer, event, a } = await setup()
    const { groups: created } = await createGroup(deps, officer.actor, {
      eventId: event.id,
      name: 'Пати',
    })
    const groupId = created[0]!.id
    await moveMember(deps, officer.actor, {
      eventId: event.id,
      userId: a.user.id,
      groupId,
    })
    const renamed = await renameGroup(deps, officer.actor, {
      groupId,
      name: 'Танки',
    })
    expect(renamed.groups[0]!.name).toBe('Танки')
    const { groups } = await deleteGroup(deps, officer.actor, { groupId })
    expect(groups).toEqual([])
    // Пользователь и аккаунт на месте — снова можно назначить.
    const again = await createGroup(deps, officer.actor, {
      eventId: event.id,
      name: 'Пати',
    })
    await moveMember(deps, officer.actor, {
      eventId: event.id,
      userId: a.user.id,
      groupId: again.groups[0]!.id,
    })
  })

  it('assigns only the current roster to groups (GRP-05)', async () => {
    const { officer, event } = await setup()
    const { groups } = await createGroup(deps, officer.actor, {
      eventId: event.id,
      name: 'Пати',
    })
    for (const role of ['reader', 'applicant'] as const) {
      const user = await createProfiledUser(db, role)
      await rejects(
        moveMember(deps, officer.actor, {
          eventId: event.id,
          userId: user.id,
          groupId: groups[0]!.id,
        }),
        'validation_failed',
      )
    }
  })

  it('rejects a group of another event', async () => {
    const { officer, event, a } = await setup()
    const other = await createEvent(deps, officer.actor, fields)
    const { groups } = await createGroup(deps, officer.actor, {
      eventId: other.id,
      name: 'Чужая',
    })
    await rejects(
      moveMember(deps, officer.actor, {
        eventId: event.id,
        userId: a.user.id,
        groupId: groups[0]!.id,
      }),
      'not_found',
    )
  })

  it('keeps one group per member under parallel moves (GRP-06)', async () => {
    const { officer, event, a, b, c } = await setup()
    let { groups } = await createGroup(deps, officer.actor, {
      eventId: event.id,
      name: 'Пати 1',
    })
    ;({ groups } = await createGroup(deps, officer.actor, {
      eventId: event.id,
      name: 'Пати 2',
    }))
    const ids = groups.map((g) => g.id)
    await Promise.all(
      [a, b, c].flatMap((user) =>
        ids.map((groupId) =>
          moveMember(deps, officer.actor, {
            eventId: event.id,
            userId: user.user.id,
            groupId,
            position: 0,
          }),
        ),
      ),
    )
    const details = await getEvent(deps, officer.actor, { id: event.id })
    const placed = details.groups.flatMap((g) => g.members.map((m) => m.userId))
    expect(placed.sort()).toEqual([a, b, c].map((u) => u.user.id).sort())
    for (const group of details.groups) {
      expect(group.members.length).toBeLessThanOrEqual(3)
    }
  })

  it('deleting an event removes its groups (EVT-10)', async () => {
    const { officer, event, a } = await setup()
    const { groups } = await createGroup(deps, officer.actor, {
      eventId: event.id,
      name: 'Пати',
    })
    await moveMember(deps, officer.actor, {
      eventId: event.id,
      userId: a.user.id,
      groupId: groups[0]!.id,
    })
    await deleteEvent(deps, officer.actor, { id: event.id })
    const left = await db.selectFrom('app.event_groups').select('id').execute()
    expect(left).toEqual([])
  })
})

describe('group templates (GRP-12–15)', () => {
  it('saves a copy, applies only «Приду» and a leader only if included', async () => {
    const { officer, event, a, b, c } = await setup()
    const saved = await saveGroupTemplate(deps, officer.actor, {
      name: 'Основа',
      groups: [
        {
          name: 'Пати 1',
          members: [
            { userId: a.user.id, isLeader: false },
            { userId: b.user.id, isLeader: true },
          ],
        },
        { name: 'Пати 2', members: [{ userId: c.user.id }] },
      ],
    })
    expect(saved.items).toHaveLength(1)
    expect(saved.items[0]!.createdBy?.gameNickname).toBe(officer.user.nickname)

    // Другое событие: a — «Приду», b — «50/50», c — «Приду».
    const target = await createEvent(deps, officer.actor, fields)
    await respondToEvent(deps, a.actor, { eventId: target.id, answer: 'yes' })
    await respondToEvent(deps, b.actor, { eventId: target.id, answer: 'maybe' })
    await respondToEvent(deps, c.actor, { eventId: target.id, answer: 'yes' })
    // Существующие группы заменяются.
    await createGroup(deps, officer.actor, {
      eventId: target.id,
      name: 'Старая',
    })

    const { groups } = await applyGroupTemplate(deps, officer.actor, {
      eventId: target.id,
      templateId: saved.items[0]!.id,
    })
    expect(layout(groups)).toEqual([
      { name: 'Пати 1', members: [a.user.id] },
      { name: 'Пати 2', members: [c.user.id] },
    ])
    // Шаблон — копия, а не ссылка на событие (GRP-14).
    await moveMember(deps, officer.actor, {
      eventId: target.id,
      userId: a.user.id,
      groupId: null,
    })
    const [template] = (await listGroupTemplates(deps, officer.actor)).items
    expect(template!.groups[0]!.members.map((m) => m.userId)).toEqual([
      a.user.id,
      b.user.id,
    ])
    expect(event.id).not.toBe(target.id)
  })

  it('validates templates: name, groups, members and the limit of 20', async () => {
    const { officer, a } = await setup()
    const reader = await createProfiledUser(db, 'reader')
    for (const body of [
      { name: '', groups: [{ name: 'Пати', members: [] }] },
      { name: 'Шаблон', groups: [] },
      {
        name: 'Шаблон',
        groups: [
          { name: 'Пати 1', members: [{ userId: a.user.id }] },
          { name: 'Пати 2', members: [{ userId: a.user.id }] },
        ],
      },
      {
        name: 'Шаблон',
        groups: [{ name: 'Пати', members: [{ userId: reader.id }] }],
      },
    ]) {
      await rejects(
        saveGroupTemplate(deps, officer.actor, body),
        'validation_failed',
      )
    }
    for (let index = 0; index < 20; index += 1) {
      await saveGroupTemplate(deps, officer.actor, {
        name: `Шаблон ${index}`,
        groups: [{ name: 'Пати', members: [] }],
      })
    }
    await rejects(
      saveGroupTemplate(deps, officer.actor, {
        name: 'Лишний',
        groups: [{ name: 'Пати', members: [] }],
      }),
      'validation_failed',
    )
  })

  it('shares the library and audits save and delete only (Q-54)', async () => {
    const { officer, event, a } = await setup()
    const other = await roleActor('officer')
    const saved = await saveGroupTemplate(deps, officer.actor, {
      name: 'Основа',
      groups: [{ name: 'Пати', members: [{ userId: a.user.id }] }],
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
    await setGroupLeader(deps, officer.actor, {
      groupId: groups[0]!.id,
      userId: a.user.id,
    })
    const left = await deleteGroupTemplate(deps, other.actor, {
      id: saved.items[0]!.id,
    })
    expect(left.items).toEqual([])
    expect(await auditActions()).toEqual([
      'event_created',
      'group_template_created',
      'group_template_deleted',
    ])
  })
})

describe('events/close (EVT-08, ACT-01–03)', () => {
  it('records visited, missed and unmarked once and freezes the event', async () => {
    const { officer, event, a, b, c } = await setup()
    // A — в группе, B — ответил вне группы, C — без ответа.
    await respondToEvent(deps, b.actor, { eventId: event.id, answer: 'yes' })
    const { groups } = await createGroup(deps, officer.actor, {
      eventId: event.id,
      name: 'Пати',
    })
    const groupId = groups[0]!.id
    await moveMember(deps, officer.actor, {
      eventId: event.id,
      userId: a.user.id,
      groupId,
    })
    await setGroupLeader(deps, officer.actor, { groupId, userId: a.user.id })
    // Чтец, стоящий в группе, тоже в итоге; чтец вне группы — нет.
    const leaver = await roleActor('member')
    await moveMember(deps, officer.actor, {
      eventId: event.id,
      userId: leaver.user.id,
      groupId,
    })
    await db
      .updateTable('app.profiles')
      .set({ access_role: 'reader' })
      .where('id', '=', leaver.user.id)
      .execute()
    const outsider = await createProfiledUser(db, 'reader')

    const closed = await closeEvent(deps, officer.actor, { id: event.id })
    expect(closed.closedAt).not.toBeNull()
    expect(closed.canManage).toBe(false)
    expect(closed.canManageGroups).toBe(false)
    expect(closed.canClose).toBe(false)
    const status = Object.fromEntries(
      closed.participants.map((p) => [p.id, p.status]),
    )
    expect(status[a.user.id]).toBe('visited')
    expect(status[b.user.id]).toBe('missed')
    expect(status[c.user.id]).toBe('unmarked')
    expect(status[officer.user.id]).toBe('unmarked')
    expect(status[leaver.user.id]).toBe('visited')
    expect(status[outsider.id]).toBeUndefined()

    const records = await db
      .selectFrom('app.event_activity_records')
      .select(['user_id', 'status', 'group_name', 'is_leader'])
      .where('event_id', '=', event.id)
      .execute()
    expect(records).toHaveLength(5)
    expect(records.find((r) => r.user_id === a.user.id)).toMatchObject({
      group_name: 'Пати',
      is_leader: true,
    })

    // Повторное закрытие не начисляет второй раз.
    await rejects(
      closeEvent(deps, officer.actor, { id: event.id }),
      'state_conflict',
    )
    // Закрытое событие не меняется (GRP-16, EVT-09).
    await rejects(
      createGroup(deps, officer.actor, { eventId: event.id, name: 'Новая' }),
      'state_conflict',
    )
    await rejects(
      moveMember(deps, officer.actor, {
        eventId: event.id,
        userId: a.user.id,
        groupId: null,
      }),
      'state_conflict',
    )
    await rejects(
      setGroupLeader(deps, officer.actor, { groupId, userId: null }),
      'state_conflict',
    )
    await rejects(
      deleteGroup(deps, officer.actor, { groupId }),
      'state_conflict',
    )
    await rejects(
      updateEvent(deps, officer.actor, { ...fields, id: event.id }),
      'state_conflict',
    )
    await rejects(
      deleteEvent(deps, officer.actor, { id: event.id }),
      'state_conflict',
    )
    await rejects(
      respondToEvent(deps, c.actor, { eventId: event.id, answer: 'yes' }),
      'state_conflict',
    )
    expect((await auditActions()).at(-1)).toBe('event_closed')
  })

  it('keeps the closing snapshot when nickname and class change (ACT-03)', async () => {
    const { officer, event, a } = await setup()
    await closeEvent(deps, officer.actor, { id: event.id })
    await db
      .updateTable('app.profiles')
      .set({ game_nickname: 'Новый', class_id: 2 })
      .where('id', '=', a.user.id)
      .execute()
    const details = await getEvent(deps, a.actor, { id: event.id })
    const row = details.participants.find((p) => p.id === a.user.id)
    expect(row).toMatchObject({ gameNickname: a.user.nickname, classId: 1 })
    // Вступивший позже не появляется в итоге задним числом (ACT-02).
    const late = await roleActor('member')
    const again = await getEvent(deps, late.actor, { id: event.id })
    expect(again.participants.some((p) => p.id === late.user.id)).toBe(false)
  })

  it('lets the author officer, any officer for recurring and admins close (EVT-07, Q-47)', async () => {
    const { event } = await setup()
    const other = await roleActor('officer')
    await rejects(closeEvent(deps, other.actor, { id: event.id }), 'forbidden')
    const admin = await roleActor('admin')
    await closeEvent(deps, admin.actor, { id: event.id })
    const recurring = await db
      .insertInto('app.events')
      .values({
        title: 'МТВ',
        event_type: 'clan',
        description: 'Еженедельное',
        starts_at: moscowToUtc('2026-11-14', '20:00').toISOString(),
        recurring_preset: 'mtv_sat_20',
      })
      .returning('id')
      .executeTakeFirstOrThrow()
    await closeEvent(deps, other.actor, { id: recurring.id })
  })

  it('serializes closing with a parallel move: the snapshot matches the final groups', async () => {
    const { officer, event, a } = await setup()
    const { groups } = await createGroup(deps, officer.actor, {
      eventId: event.id,
      name: 'Пати',
    })
    const results = await Promise.allSettled([
      moveMember(deps, officer.actor, {
        eventId: event.id,
        userId: a.user.id,
        groupId: groups[0]!.id,
      }),
      closeEvent(deps, officer.actor, { id: event.id }),
    ])
    expect(results[1]!.status).toBe('fulfilled')
    const record = await db
      .selectFrom('app.event_activity_records')
      .select('status')
      .where('event_id', '=', event.id)
      .where('user_id', '=', a.user.id)
      .executeTakeFirstOrThrow()
    const moved = results[0]!.status === 'fulfilled'
    expect(record.status).toBe(moved ? 'visited' : 'unmarked')
  })

  it('closes before the start and without groups (EVT-02)', async () => {
    const { officer, event } = await setup()
    const closed = await closeEvent(deps, officer.actor, { id: event.id })
    expect(closed.participants.every((p) => p.status !== 'visited')).toBe(true)
  })
})
