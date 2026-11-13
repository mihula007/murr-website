import { sql } from 'kysely'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  restoreReader,
  setRole,
} from '../../supabase/functions/_shared/accounts/service.ts'
import type { AppDeps } from '../../supabase/functions/_shared/app.ts'
import { applicationRepository } from '../../supabase/functions/_shared/applications/repository.ts'
import { GUEST } from '../../supabase/functions/_shared/auth/actor.ts'
import type { AccessRole } from '../../supabase/functions/_shared/contracts/account.ts'
import {
  createEvent,
  respondToEvent,
  updateEvent,
} from '../../supabase/functions/_shared/events/service.ts'
import {
  applyGroupTemplate,
  createGroup,
  moveMember,
  saveGroupTemplate,
  setGroupLeader,
} from '../../supabase/functions/_shared/groups/service.ts'
import { saveListing } from '../../supabase/functions/_shared/market/service.ts'
import {
  listNotifications,
  markSectionSeen,
  notificationSummary,
  notify,
  readAllNotifications,
  readNotification,
} from '../../supabase/functions/_shared/notifications/service.ts'
import { savePublication } from '../../supabase/functions/_shared/publications/service.ts'
import { createVote } from '../../supabase/functions/_shared/votes/service.ts'
import {
  actorOf,
  createAuthUser,
  createProfiledUser,
  resetAppData,
  testDb,
  testDeps,
} from './support.ts'

const db = testDb()
const deps: AppDeps = testDeps(db)
const later: AppDeps = { ...deps, now: () => new Date(Date.now() + 60_000) }

beforeEach(() => resetAppData(db))
afterAll(() => db.destroy())

const rejects = (promise: Promise<unknown>, code: string) =>
  expect(promise).rejects.toMatchObject({ code })

async function roleActor(role: AccessRole) {
  const user = await createProfiledUser(db, role)
  return { user, actor: await actorOf(db, user.id) }
}

/**
 * Отметки просмотра — текущее время часов БД: всё, что создано следующими
 * транзакциями, новое. Время публикации берётся из `deps.now()`, поэтому
 * публикации сохраняются с `later` — без зависимости от сдвига часов Docker.
 */
async function markSeenNow(userId: string) {
  await db
    .updateTable('app.section_views')
    .set({ seen_at: sql<string>`clock_timestamp()` })
    .where('user_id', '=', userId)
    .execute()
}

async function notificationsOf(userId: string) {
  return db
    .selectFrom('app.user_notifications')
    .select(['kind', 'title', 'body', 'target_kind', 'target_id'])
    .where('recipient_id', '=', userId)
    .orderBy('created_at')
    .execute()
}

async function seed(recipientId: string, count: number) {
  for (let index = 0; index < count; index += 1) {
    await notify(db, {
      recipientId,
      actorId: null,
      kind: 'discussion_mention',
      title: `Упоминание ${index}`,
      source: { kind: 'test', id: String(index) },
    })
  }
}

const eventFields = {
  title: 'Рейд',
  type: 'pve',
  date: '2099-11-14',
  time: '20:00',
  description: 'Собираемся у портала',
}

const doc = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Текст' }] }],
}

const material = (status: 'draft' | 'published') => ({
  status,
  category: 'guide',
  title: 'Гайд',
  summary: null,
  content: doc,
  showAuthor: true,
  discussionEnabled: false,
  attachments: [],
})

const listing = (status: 'draft' | 'published') => ({
  status,
  category: 'sale',
  title: 'Продам меч',
  summary: null,
  content: doc,
  discussionEnabled: false,
})

describe('notifications: access (NTF-01, HOM-10)', () => {
  it('rejects a guest, an incomplete registration and a reader', async () => {
    const calls = (actor: Parameters<typeof notificationSummary>[1]) => [
      notificationSummary(deps, actor),
      listNotifications(deps, actor),
      readNotification(deps, actor, { id: crypto.randomUUID() }),
      readAllNotifications(deps, actor),
      markSectionSeen(deps, actor, { section: 'events' }),
    ]
    for (const call of calls(GUEST)) {
      await rejects(call, 'not_authenticated')
    }
    const incomplete = await actorOf(db, (await createAuthUser()).id)
    for (const call of calls(incomplete)) {
      await rejects(call, 'registration_incomplete')
    }
    const reader = await roleActor('reader')
    for (const call of calls(reader.actor)) {
      await rejects(call, 'forbidden')
    }
  })

  it('gives an applicant the bell without section counters', async () => {
    const applicant = await roleActor('applicant')
    expect(await notificationSummary(deps, applicant.actor)).toEqual({
      unreadCount: 0,
      sections: {},
    })
    await rejects(
      markSectionSeen(deps, applicant.actor, { section: 'events' }),
      'forbidden',
    )
  })
})

describe('notifications: panel and reading (NTF-02, NTF-05, Q-64)', () => {
  it('lists the last 50 own notifications, newest first, and counts every unread', async () => {
    const member = await roleActor('member')
    const other = await roleActor('member')
    await seed(member.user.id, 55)
    await seed(other.user.id, 2)
    const list = await listNotifications(deps, member.actor)
    expect(list.items).toHaveLength(50)
    expect(list.unreadCount).toBe(55)
    expect(list.items[0]).toMatchObject({
      kind: 'discussion_mention',
      title: 'Упоминание 54',
      target: null,
      readAt: null,
    })
  })

  it('reads one own notification; a foreign one is not found', async () => {
    const member = await roleActor('member')
    const other = await roleActor('member')
    await seed(member.user.id, 2)
    await seed(other.user.id, 1)
    const [first] = (await listNotifications(deps, member.actor)).items
    const [foreign] = (await listNotifications(deps, other.actor)).items
    expect(
      await readNotification(deps, member.actor, { id: first!.id }),
    ).toEqual({ unreadCount: 1 })
    await rejects(
      readNotification(deps, member.actor, { id: foreign!.id }),
      'not_found',
    )
    const again = await listNotifications(deps, member.actor)
    const readAt = again.items[0]!.readAt
    expect(readAt).not.toBeNull()
    await readNotification(deps, member.actor, { id: first!.id })
    expect((await listNotifications(deps, member.actor)).items[0]!.readAt).toBe(
      readAt,
    )
  })

  it('reads all own notifications, keeps the history and leaves others intact', async () => {
    const member = await roleActor('member')
    const other = await roleActor('member')
    await seed(member.user.id, 60)
    await seed(other.user.id, 3)
    expect(await readAllNotifications(deps, member.actor)).toEqual({
      unreadCount: 0,
    })
    const list = await listNotifications(deps, member.actor)
    expect(list.items).toHaveLength(50)
    expect(list.unreadCount).toBe(0)
    expect((await notificationSummary(deps, other.actor)).unreadCount).toBe(3)
  })
})

describe('notifications: section counters (NTF-09–12, Q-67)', () => {
  it('starts every available section from zero for each role', async () => {
    const officer = await roleActor('officer')
    await createEvent(deps, officer.actor, eventFields)
    const member = await roleActor('member')
    const admin = await roleActor('admin')
    expect((await notificationSummary(deps, member.actor)).sections).toEqual({
      events: 0,
      votes: 0,
      publications: 0,
      market: 0,
    })
    expect(
      Object.keys((await notificationSummary(deps, officer.actor)).sections),
    ).toEqual(['events', 'votes', 'publications', 'market', 'applications'])
    expect(
      Object.keys((await notificationSummary(deps, admin.actor)).sections),
    ).toEqual([
      'events',
      'votes',
      'publications',
      'market',
      'applications',
      'accounts',
    ])
  })

  it('counts objects of others after the last view and ignores own, drafts and edits', async () => {
    const officer = await roleActor('officer')
    const member = await roleActor('member')
    const old = await createEvent(deps, officer.actor, eventFields)
    await notificationSummary(deps, member.actor)
    await notificationSummary(deps, officer.actor)
    await markSeenNow(member.user.id)
    await markSeenNow(officer.user.id)

    await createEvent(deps, officer.actor, eventFields)
    await updateEvent(deps, officer.actor, {
      id: old.id,
      ...eventFields,
      title: 'Рейд (перенос)',
    })
    await createVote(deps, officer.actor, {
      title: 'Куда идём?',
      context: '',
      options: ['Башня', 'Пещера'],
    })
    await savePublication(later, officer.actor, material('published'))
    await savePublication(later, officer.actor, material('draft'))
    await saveListing(later, member.actor, listing('published'))

    expect((await notificationSummary(deps, member.actor)).sections).toEqual({
      events: 1,
      votes: 1,
      publications: 1,
      market: 0,
    })
    expect((await notificationSummary(deps, officer.actor)).sections).toEqual({
      events: 0,
      votes: 0,
      publications: 0,
      market: 1,
      applications: 0,
    })
  })

  it('counts new applications for officers and new accounts for admins', async () => {
    const officer = await roleActor('officer')
    const admin = await roleActor('admin')
    await notificationSummary(deps, officer.actor)
    await notificationSummary(deps, admin.actor)
    await markSeenNow(officer.user.id)
    await markSeenNow(admin.user.id)
    const applicant = await createProfiledUser(db, 'applicant')
    await applicationRepository.create(db, applicant.id, [
      'https://example.com/gear.png',
    ])
    expect(
      (await notificationSummary(deps, officer.actor)).sections.applications,
    ).toBe(1)
    const sections = (await notificationSummary(deps, admin.actor)).sections
    expect(sections.applications).toBe(1)
    expect(sections.accounts).toBe(1)
  })

  it('resets only the opened section of the viewer (NTF-11)', async () => {
    const officer = await roleActor('officer')
    const a = await roleActor('member')
    const b = await roleActor('member')
    for (const user of [a, b]) {
      await notificationSummary(deps, user.actor)
      await markSeenNow(user.user.id)
    }
    await createEvent(deps, officer.actor, eventFields)
    await createVote(deps, officer.actor, {
      title: 'Куда идём?',
      context: '',
      options: ['Башня', 'Пещера'],
    })
    await markSectionSeen(later, a.actor, { section: 'events' })
    expect((await notificationSummary(deps, a.actor)).sections).toMatchObject({
      events: 0,
      votes: 1,
    })
    expect((await notificationSummary(deps, b.actor)).sections).toMatchObject({
      events: 1,
      votes: 1,
    })
    // Более ранняя отметка не опускает уже поднятую.
    await markSectionSeen(
      { ...deps, now: () => new Date(Date.now() - 2 * 60 * 60 * 1000) },
      a.actor,
      { section: 'events' },
    )
    expect((await notificationSummary(deps, a.actor)).sections.events).toBe(0)
  })

  it('rejects marking a section the role cannot open or an unknown section', async () => {
    const member = await roleActor('member')
    await rejects(
      markSectionSeen(deps, member.actor, { section: 'applications' }),
      'forbidden',
    )
    await rejects(
      markSectionSeen(deps, member.actor, { section: 'roster' }),
      'validation_failed',
    )
  })
})

describe('notifications: sources (NTF-03, NTF-04, Q-65)', () => {
  async function eventSetup() {
    const officer = await roleActor('officer')
    const event = await createEvent(deps, officer.actor, eventFields)
    const a = await roleActor('member')
    const { groups } = await createGroup(deps, officer.actor, {
      eventId: event.id,
      name: 'Пати 1',
    })
    const { groups: both } = await createGroup(deps, officer.actor, {
      eventId: event.id,
      name: 'Пати 2',
    })
    return { officer, event, a, g1: groups[0]!, g2: both[1]! }
  }

  it('notifies once about being added to a group of an event', async () => {
    const { officer, event, a, g1, g2 } = await eventSetup()
    const move = (groupId: string | null) =>
      moveMember(deps, officer.actor, {
        eventId: event.id,
        userId: a.user.id,
        groupId,
      })
    await move(g1.id)
    await move(g2.id)
    await move(null)
    await move(g1.id)
    expect(await notificationsOf(a.user.id)).toEqual([
      {
        kind: 'group_added',
        title: 'Вы добавлены в группу',
        body: 'Рейд · Пати 1',
        target_kind: 'event',
        target_id: event.id,
      },
    ])
  })

  it('notifies once about the party leader and never the manager about himself', async () => {
    const { officer, event, a, g1 } = await eventSetup()
    for (const userId of [a.user.id, officer.user.id]) {
      await moveMember(deps, officer.actor, {
        eventId: event.id,
        userId,
        groupId: g1.id,
      })
    }
    await setGroupLeader(deps, officer.actor, {
      groupId: g1.id,
      userId: a.user.id,
    })
    await setGroupLeader(deps, officer.actor, { groupId: g1.id, userId: null })
    await setGroupLeader(deps, officer.actor, {
      groupId: g1.id,
      userId: a.user.id,
    })
    await setGroupLeader(deps, officer.actor, {
      groupId: g1.id,
      userId: officer.user.id,
    })
    expect((await notificationsOf(a.user.id)).map((n) => n.kind)).toEqual([
      'group_added',
      'group_leader',
    ])
    expect(await notificationsOf(officer.user.id)).toEqual([])
  })

  it('notifies members placed by a group template, leaders included', async () => {
    const { officer, event, a } = await eventSetup()
    const b = await roleActor('member')
    for (const user of [a, b]) {
      await respondToEvent(deps, user.actor, {
        eventId: event.id,
        answer: 'yes',
      })
    }
    const template = await saveGroupTemplate(deps, officer.actor, {
      name: 'Рейдовый состав',
      groups: [
        {
          name: 'Танки',
          members: [
            { userId: a.user.id, isLeader: true },
            { userId: b.user.id, isLeader: false },
          ],
        },
      ],
    })
    const templateId = template.items[0]!.id
    await applyGroupTemplate(deps, officer.actor, {
      eventId: event.id,
      templateId,
    })
    // Одна транзакция — одинаковое время создания: порядок не важен.
    expect(
      (await notificationsOf(a.user.id)).map((n) => n.kind).sort(),
    ).toEqual(['group_added', 'group_leader'])
    expect((await notificationsOf(b.user.id)).map((n) => n.kind)).toEqual([
      'group_added',
    ])
  })

  it('does not notify the event author about answers (Q-65)', async () => {
    const { officer, event, a } = await eventSetup()
    await respondToEvent(deps, a.actor, { eventId: event.id, answer: 'yes' })
    await respondToEvent(deps, a.actor, { eventId: event.id, answer: 'no' })
    expect(await notificationsOf(officer.user.id)).toEqual([])
  })

  it('notifies about each role change and a restored reader', async () => {
    const admin = await roleActor('admin')
    const officer = await roleActor('officer')
    const member = await roleActor('member')
    await setRole(deps, admin.actor, {
      userId: member.user.id,
      role: 'officer',
    })
    await setRole(deps, admin.actor, {
      userId: member.user.id,
      role: 'officer',
    })
    await setRole(deps, admin.actor, { userId: member.user.id, role: 'reader' })
    await restoreReader(deps, officer.actor, { userId: member.user.id })
    expect(
      (await notificationsOf(member.user.id)).map((n) => [n.kind, n.body]),
    ).toEqual([
      ['role_changed', 'Член клана → Офицер'],
      ['role_changed', 'Офицер → Чтец'],
      ['role_changed', 'Чтец → Член клана'],
    ])
    expect(await notificationsOf(admin.user.id)).toEqual([])
  })
})
