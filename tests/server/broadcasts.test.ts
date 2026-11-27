import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppDeps } from '../../supabase/functions/_shared/app.ts'
import { GUEST } from '../../supabase/functions/_shared/auth/actor.ts'
import {
  deleteBroadcastTemplate,
  deleteDraft,
  broadcastRecipients,
  listBroadcastSubscriptions,
  listBroadcastTemplates,
  listDrafts,
  prefillBroadcast,
  sendAnnouncement,
  saveBroadcastTemplate,
  saveDraft,
} from '../../supabase/functions/_shared/broadcasts/service.ts'
import type { AccessRole } from '../../supabase/functions/_shared/contracts/account.ts'
import { BROADCAST_LIMITS } from '../../supabase/functions/_shared/contracts/broadcasts.ts'
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
  castBallot,
  closeVote,
  createVote,
} from '../../supabase/functions/_shared/votes/service.ts'
import {
  actorOf,
  createAuthUser,
  createProfiledUser,
  fakeTelegram,
  resetAppData,
  testDb,
  testDeps,
} from './support.ts'

const db = testDb()
const deps: AppDeps = testDeps(db)

beforeEach(() => resetAppData(db))
afterAll(() => db.destroy())

const rejects = (promise: Promise<unknown>, code: string) =>
  expect(promise).rejects.toMatchObject({ code })

async function roleActor(role: AccessRole) {
  const user = await createProfiledUser(db, role)
  return { user, actor: await actorOf(db, user.id) }
}

const eventFields = {
  title: 'Рейд',
  type: 'pve',
  date: '2099-11-14',
  time: '20:00',
  description: 'Собираемся у портала',
}

const draft = (overrides: Record<string, unknown> = {}) => ({
  subject: 'Сбор',
  body: 'Сегодня рейд',
  channels: ['telegram', 'vk', 'max'],
  ...overrides,
})

const template = (overrides: Record<string, unknown> = {}) => ({
  name: 'Сбор на рейд',
  subject: 'Сбор',
  body: 'Сегодня рейд',
  channels: ['telegram'],
  ...overrides,
})

async function auditActions() {
  const rows = await db
    .selectFrom('app.audit_log')
    .select(['action', 'category', 'details'])
    .where('category', '=', 'broadcast')
    .orderBy('id')
    .execute()
  return rows
}

describe('broadcasts: access (BRC, ACL)', () => {
  it('rejects guests, incomplete registration and non-manager roles', async () => {
    const incomplete = await actorOf(db, (await createAuthUser()).id)
    const cases: [unknown, string][] = [
      [GUEST, 'not_authenticated'],
      [incomplete, 'registration_incomplete'],
    ]
    for (const role of ['applicant', 'reader', 'member'] as const) {
      cases.push([(await roleActor(role)).actor, 'forbidden'])
    }
    for (const [actor, code] of cases) {
      const a = actor as Parameters<typeof listDrafts>[1]
      await rejects(listDrafts(deps, a), code)
      await rejects(saveDraft(deps, a, draft()), code)
      await rejects(listBroadcastTemplates(deps, a), code)
      await rejects(saveBroadcastTemplate(deps, a, template()), code)
      await rejects(
        prefillBroadcast(deps, a, {
          source: 'event',
          id: '00000000-0000-0000-0000-000000000000',
        }),
        code,
      )
    }

    const master = await roleActor('master')
    const saved = await saveDraft(deps, master.actor, draft())
    expect((await listDrafts(deps, master.actor)).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: saved.items[0]!.id }),
      ]),
    )
  })
})

describe('officer permissions', () => {
  it('checks the three independent broadcast privileges', async () => {
    const officerUser = await createProfiledUser(db, 'officer', {
      officerPermissions: [],
    })
    const officer = await actorOf(db, officerUser.id)

    await rejects(listDrafts(deps, officer), 'forbidden')
    await rejects(listBroadcastTemplates(deps, officer), 'forbidden')
    await rejects(
      listBroadcastSubscriptions(deps, officer, { limit: 20 }),
      'forbidden',
    )
  })

  it('lets a sender apply shared templates without managing them', async () => {
    const officerUser = await createProfiledUser(db, 'officer', {
      officerPermissions: ['broadcasts.send'],
    })
    const officer = await actorOf(db, officerUser.id)

    await expect(listBroadcastTemplates(deps, officer)).resolves.toMatchObject({
      items: [],
    })
  })
})

describe('broadcasts/subscriptions (BRC-15, Q-112)', () => {
  it('returns whole-clan subscription counts including stopped links', async () => {
    const manager = await roleActor('officer')
    const linked = await createProfiledUser(db, 'member')
    await createProfiledUser(db, 'reader')
    await db
      .insertInto('app.telegram_links')
      .values({
        user_id: linked.id,
        telegram_user_id: 81000,
        chat_id: 81000,
        display_name: 'Linked Telegram',
      })
      .execute()
    await db
      .insertInto('app.vk_links')
      .values({
        user_id: linked.id,
        vk_user_id: 81001,
        chat_id: 81001,
        display_name: 'Stopped VK',
        blocked_at: new Date().toISOString(),
      })
      .execute()

    const result = await listBroadcastSubscriptions(deps, manager.actor, {})

    expect(result.summary).toEqual({
      total: 2,
      any: 1,
      none: 1,
      telegram: 1,
      vk: 1,
      max: 0,
    })
  })

  it('returns only nick, role and messenger link states to managers', async () => {
    const manager = await roleActor('officer')
    const member = await createProfiledUser(db, 'member')
    await db
      .updateTable('app.profiles')
      .set({ game_nickname: 'Target' })
      .where('id', '=', member.id)
      .execute()
    await db
      .insertInto('app.telegram_links')
      .values({
        user_id: member.id,
        telegram_user_id: 81001,
        chat_id: 81001,
        display_name: 'Hidden Telegram name',
      })
      .execute()
    await db
      .insertInto('app.vk_links')
      .values({
        user_id: member.id,
        vk_user_id: 81002,
        chat_id: 81002,
        display_name: 'Hidden VK name',
        blocked_at: new Date().toISOString(),
      })
      .execute()
    const result = await listBroadcastSubscriptions(deps, manager.actor, {})
    const target = result.items.find((item) => item.gameNickname === 'Target')
    expect(target).toEqual({
      id: member.id,
      gameNickname: 'Target',
      role: 'member',
      telegram: { linked: true, blocked: false },
      vk: { linked: true, blocked: true },
      max: { linked: false, blocked: false },
    })
    expect(target).not.toHaveProperty('email')
    expect(target).not.toHaveProperty('displayName')
  })

  it('filters profiles without any messenger link only when requested', async () => {
    const manager = await roleActor('officer')
    const unlinked = await createProfiledUser(db, 'member')
    const blocked = await createProfiledUser(db, 'member')
    for (const [user, nickname] of [
      [unlinked, 'FltNo1'],
      [blocked, 'FltBlk1'],
    ] as const) {
      await db
        .updateTable('app.profiles')
        .set({ game_nickname: nickname })
        .where('id', '=', user.id)
        .execute()
    }
    await db
      .insertInto('app.max_links')
      .values({
        user_id: blocked.id,
        max_user_id: 81003,
        chat_id: 81003,
        display_name: 'Blocked account',
        blocked_at: new Date().toISOString(),
      })
      .execute()

    const all = await listBroadcastSubscriptions(deps, manager.actor, {
      search: 'Flt',
    })
    const filtered = await listBroadcastSubscriptions(deps, manager.actor, {
      search: 'Flt',
      unlinkedOnly: true,
    })

    expect(all.items.map((item) => item.id)).toEqual(
      expect.arrayContaining([unlinked.id, blocked.id]),
    )
    expect(filtered.items.map((item) => item.id)).toEqual([unlinked.id])
  })

  it('rejects non-managers and searches nicknames on the server', async () => {
    const member = await createProfiledUser(db, 'member')
    const reader = await createProfiledUser(db, 'reader')
    const applicant = await createProfiledUser(db, 'applicant')
    for (const user of [member, reader, applicant]) {
      await rejects(
        listBroadcastSubscriptions(deps, await actorOf(db, user.id), {}),
        'forbidden',
      )
      await rejects(
        broadcastRecipients(deps, await actorOf(db, user.id), {}),
        'forbidden',
      )
    }
    const officer = await roleActor('officer')
    await db
      .updateTable('app.profiles')
      .set({ game_nickname: 'NickMatch' })
      .where('id', '=', member.id)
      .execute()
    const result = await listBroadcastSubscriptions(deps, officer.actor, {
      search: 'nickm',
    })
    expect(result.items.map((item) => item.gameNickname)).toEqual(['NickMatch'])
  })

  it('continues after 50 nicknames without duplicates', async () => {
    const admin = await roleActor('admin')
    const ids: string[] = []
    let linkedId: string | null = null
    for (let index = 0; index < 52; index += 1) {
      const user = await createProfiledUser(db, 'member')
      if (index === 0) {
        linkedId = user.id
      } else {
        ids.push(user.id)
      }
      await db
        .updateTable('app.profiles')
        .set({ game_nickname: `XxP-${String(index).padStart(2, '0')}` })
        .where('id', '=', user.id)
        .execute()
    }
    await db
      .insertInto('app.telegram_links')
      .values({
        user_id: linkedId!,
        telegram_user_id: 81004,
        chat_id: 81004,
        display_name: 'Linked account',
      })
      .execute()
    const first = await listBroadcastSubscriptions(deps, admin.actor, {
      limit: 50,
      search: 'XxP-',
      unlinkedOnly: true,
    })
    const second = await listBroadcastSubscriptions(deps, admin.actor, {
      cursor: first.nextCursor,
      limit: 50,
      search: 'XxP-',
      unlinkedOnly: true,
    })
    expect(first.items).toHaveLength(50)
    expect(first.nextCursor).toBeTruthy()
    expect(second.items).toHaveLength(1)
    expect(second.nextCursor).toBeNull()
    expect(
      new Set([...first.items, ...second.items].map((item) => item.id)).size,
    ).toBe(51)
    expect(
      [...first.items, ...second.items].map((item) => item.id),
    ).not.toContain(linkedId)
  })
})

describe('broadcasts/recipients (BRC-16)', () => {
  it('filters visible rows by class without narrowing channel totals', async () => {
    const manager = await roleActor('officer')
    const classes = await db
      .selectFrom('app.character_classes')
      .select('id')
      .orderBy('id')
      .limit(2)
      .execute()
    expect(classes).toHaveLength(2)
    const classId = Number(classes[0]!.id)
    const otherClassId = Number(classes[1]!.id)
    const selectedClass = await createProfiledUser(db, 'member')
    const otherClass = await createProfiledUser(db, 'member')
    await db
      .updateTable('app.profiles')
      .set({ class_id: classId })
      .where('id', '=', selectedClass.id)
      .execute()
    await db
      .updateTable('app.profiles')
      .set({ class_id: otherClassId })
      .where('id', '=', otherClass.id)
      .execute()
    await db
      .insertInto('app.telegram_links')
      .values([
        {
          user_id: selectedClass.id,
          telegram_user_id: 92901,
          chat_id: 92901,
          display_name: selectedClass.nickname,
        },
        {
          user_id: otherClass.id,
          telegram_user_id: 92902,
          chat_id: 92902,
          display_name: otherClass.nickname,
        },
      ])
      .execute()

    const result = await broadcastRecipients(deps, manager.actor, {
      channels: ['telegram'],
      classId,
    })
    expect(result.items.map((item) => item.id)).toContain(selectedClass.id)
    expect(result.items.map((item) => item.id)).not.toContain(otherClass.id)
    expect(result.channels?.telegram.count).toBe(2)
  })

  it('pages unique eligible profiles across selected channels', async () => {
    const manager = await roleActor('officer')
    const both = await createProfiledUser(db, 'member')
    const vkOnly = await createProfiledUser(db, 'admin')
    const blocked = await createProfiledUser(db, 'member')
    await db
      .updateTable('app.profiles')
      .set({ game_nickname: 'A both' })
      .where('id', '=', both.id)
      .execute()
    await db
      .updateTable('app.profiles')
      .set({ game_nickname: 'B VK' })
      .where('id', '=', vkOnly.id)
      .execute()

    await db
      .insertInto('app.telegram_links')
      .values([
        {
          user_id: both.id,
          telegram_user_id: 91001,
          chat_id: 91001,
          display_name: 'Hidden Telegram name',
        },
        {
          user_id: blocked.id,
          telegram_user_id: 91002,
          chat_id: 91002,
          display_name: 'Blocked',
          blocked_at: new Date().toISOString(),
        },
      ])
      .execute()
    await db
      .insertInto('app.vk_links')
      .values([
        {
          user_id: both.id,
          vk_user_id: 92001,
          chat_id: 92001,
          display_name: 'Hidden VK name',
        },
        {
          user_id: vkOnly.id,
          vk_user_id: 92002,
          chat_id: 92002,
          display_name: 'Hidden VK name',
        },
      ])
      .execute()

    const first = await broadcastRecipients(deps, manager.actor, {
      channels: ['telegram', 'vk'],
      limit: 1,
    })
    expect(first).toMatchObject({
      items: [
        { id: both.id, gameNickname: 'A both', channels: ['telegram', 'vk'] },
      ],
      nextCursor: expect.any(String),
      channels: {
        telegram: { count: 1 },
        vk: { count: 2 },
      },
    })

    const second = await broadcastRecipients(deps, manager.actor, {
      channels: ['telegram', 'vk'],
      cursor: first.nextCursor,
      limit: 1,
    })
    expect(second).toMatchObject({
      items: [{ id: vkOnly.id, gameNickname: 'B VK', channels: ['vk'] }],
      nextCursor: null,
    })

    const excluded = await broadcastRecipients(deps, manager.actor, {
      channels: ['telegram', 'vk'],
      excludedUserIds: [both.id],
    })
    expect(excluded).toMatchObject({
      channels: {
        telegram: { count: 0 },
        vk: { count: 1 },
      },
    })
  })

  it('searches on the server and continues after 50 recipients', async () => {
    const manager = await roleActor('admin')
    const members = []
    for (let index = 0; index < 51; index += 1) {
      members.push(await createProfiledUser(db, 'member'))
    }
    await db
      .insertInto('app.telegram_links')
      .values(
        members.map((member, index) => ({
          user_id: member.id,
          telegram_user_id: 93000 + index,
          chat_id: 93000 + index,
          display_name: member.nickname,
        })),
      )
      .execute()

    const first = await broadcastRecipients(deps, manager.actor, {
      channels: ['telegram'],
    })
    const firstPage = first as unknown as {
      items: { id: string; gameNickname: string }[]
      nextCursor: string | null
    }
    expect(firstPage.items).toHaveLength(50)
    expect(firstPage.nextCursor).toEqual(expect.any(String))

    const last = await broadcastRecipients(deps, manager.actor, {
      channels: ['telegram'],
      cursor: firstPage.nextCursor,
    })
    expect(last).toMatchObject({
      items: [{ id: expect.any(String), gameNickname: expect.any(String) }],
      nextCursor: null,
    })

    const search = await broadcastRecipients(deps, manager.actor, {
      channels: ['telegram'],
      search: members[50]!.nickname,
    })
    expect(search).toMatchObject({
      items: [{ id: members[50]!.id, gameNickname: members[50]!.nickname }],
      nextCursor: null,
    })
  })

  it('uses the group and event audience rules for the picker', async () => {
    const officer = await roleActor('officer')
    const inGroup = await createProfiledUser(db, 'member')
    const outsideGroup = await createProfiledUser(db, 'member')
    const event = await createEvent(deps, officer.actor, eventFields)
    const { groups } = await createGroup(deps, officer.actor, {
      eventId: event.id,
      name: 'Пати',
    })
    const groupId = groups[0]!.id
    await moveMember(deps, officer.actor, {
      eventId: event.id,
      userId: inGroup.id,
      groupId,
    })
    await db
      .insertInto('app.telegram_links')
      .values([
        {
          user_id: inGroup.id,
          telegram_user_id: 94001,
          chat_id: 94001,
          display_name: 'In group',
        },
        {
          user_id: outsideGroup.id,
          telegram_user_id: 94002,
          chat_id: 94002,
          display_name: 'Outside group',
        },
      ])
      .execute()
    await respondToEvent(deps, await actorOf(db, outsideGroup.id), {
      eventId: event.id,
      answer: 'yes',
    })

    const groupPage = await broadcastRecipients(deps, officer.actor, {
      channels: ['telegram'],
      groupId,
    })
    expect(groupPage).toMatchObject({
      items: [{ id: inGroup.id }],
    })
    const eventPage = await broadcastRecipients(deps, officer.actor, {
      channels: ['telegram'],
      eventId: event.id,
    })
    expect(eventPage).toMatchObject({
      items: [{ id: inGroup.id }],
    })
  })
})

describe('broadcasts: drafts (BRC-06, BRC-07, BRC-12, Q-69–Q-71, Q-82)', () => {
  it('saves a shared draft and audits it', async () => {
    const officer = await roleActor('officer')
    const other = await roleActor('officer')
    const { items } = await saveDraft(deps, officer.actor, draft())
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      subject: 'Сбор',
      body: 'Сегодня рейд',
      channels: ['telegram', 'vk', 'max'],
      author: { gameNickname: officer.user.nickname },
      canDelete: true,
    })
    const shared = await listDrafts(deps, other.actor)
    expect(shared.items[0]!.canDelete).toBe(false)
    expect(await auditActions()).toEqual([
      expect.objectContaining({ action: 'broadcast_draft_saved' }),
    ])
  })

  it('validates text and channels; text is at most 3800 (Q-91)', async () => {
    const officer = await roleActor('officer')
    const invalid = async (body: unknown, field: string) =>
      expect(saveDraft(deps, officer.actor, body)).rejects.toMatchObject({
        code: 'validation_failed',
        fields: expect.objectContaining({ [field]: expect.any(String) }),
      })
    await invalid(draft({ body: '   ' }), 'body')
    await invalid(draft({ channels: [] }), 'channels')
    await invalid(draft({ channels: ['email'] }), 'channels.0')
    await invalid(
      draft({ body: 'x'.repeat(BROADCAST_LIMITS.body + 1) }),
      'body',
    )
    // Тема необязательна (BRC-06).
    const { items } = await saveDraft(
      deps,
      officer.actor,
      draft({ subject: '' }),
    )
    expect(items[0]!.subject).toBeNull()
  })

  it('keeps only the latest 50 drafts, also under concurrent saves', async () => {
    const officer = await roleActor('officer')
    for (let i = 0; i < BROADCAST_LIMITS.drafts - 2; i += 1) {
      await saveDraft(deps, officer.actor, draft({ subject: `№${i}` }))
    }
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        saveDraft(deps, officer.actor, draft({ subject: `П${i}` })),
      ),
    )
    const { count } = await db
      .selectFrom('app.broadcast_drafts')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .executeTakeFirstOrThrow()
    expect(Number(count)).toBe(BROADCAST_LIMITS.drafts)
    const { items } = await listDrafts(deps, officer.actor)
    expect(items.map((item) => item.subject)).not.toContain('№0')
  })

  it('lets the author or an admin delete a draft', async () => {
    const author = await roleActor('officer')
    const other = await roleActor('officer')
    const admin = await roleActor('admin')
    const [first] = (await saveDraft(deps, author.actor, draft())).items
    await rejects(
      deleteDraft(deps, other.actor, { id: first!.id }),
      'forbidden',
    )
    const [second] = (await saveDraft(deps, author.actor, draft())).items
    expect(
      (await deleteDraft(deps, author.actor, { id: second!.id })).items,
    ).toHaveLength(1)
    expect(
      (await deleteDraft(deps, admin.actor, { id: first!.id })).items,
    ).toHaveLength(0)
    await rejects(
      deleteDraft(deps, admin.actor, { id: first!.id }),
      'not_found',
    )
    const actions = (await auditActions()).map((row) => row.action)
    expect(actions.filter((a) => a === 'broadcast_draft_deleted')).toHaveLength(
      2,
    )
  })
})

describe('broadcasts: templates (BRC-10, BRC-11)', () => {
  it('saves up to 20 templates with unique names and audits save and delete', async () => {
    const officer = await roleActor('officer')
    const admin = await roleActor('admin')
    await saveBroadcastTemplate(deps, officer.actor, template())
    await expect(
      saveBroadcastTemplate(
        deps,
        admin.actor,
        template({ name: 'СБОР НА РЕЙД' }),
      ),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      fields: { name: 'duplicate' },
    })
    await expect(
      saveBroadcastTemplate(deps, officer.actor, template({ name: ' ' })),
    ).rejects.toMatchObject({ code: 'validation_failed' })
    for (let i = 1; i < BROADCAST_LIMITS.templates; i += 1) {
      await saveBroadcastTemplate(
        deps,
        admin.actor,
        template({ name: `Ш${i}` }),
      )
    }
    await expect(
      saveBroadcastTemplate(deps, officer.actor, template({ name: 'Лишний' })),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      fields: { limit: 'too_many' },
    })
    const { items } = await listBroadcastTemplates(deps, officer.actor)
    const own = items.find((item) => item.name === 'Сбор на рейд')!
    expect(own).toMatchObject({ channels: ['telegram'], canDelete: true })
    const foreign = items.find((item) => item.name === 'Ш1')!
    expect(foreign.canDelete).toBe(false)
    await rejects(
      deleteBroadcastTemplate(deps, officer.actor, { id: foreign.id }),
      'forbidden',
    )
    await deleteBroadcastTemplate(deps, officer.actor, { id: own.id })
    await deleteBroadcastTemplate(deps, admin.actor, { id: foreign.id })
    const actions = (await auditActions()).map((row) => row.action)
    expect(
      actions.filter((a) => a === 'broadcast_template_saved'),
    ).toHaveLength(BROADCAST_LIMITS.templates)
    expect(
      actions.filter((a) => a === 'broadcast_template_deleted'),
    ).toHaveLength(2)
  })
})

describe('broadcasts: prefill from context (BRC-02–04)', () => {
  it('fills from an active event and rejects a closed one', async () => {
    const officer = await roleActor('officer')
    const event = await createEvent(deps, officer.actor, eventFields)
    const result = await prefillBroadcast(deps, officer.actor, {
      source: 'event',
      id: event.id,
    })
    expect(result.subject).toBe('Рейд')
    // Без строки-подсказки про кнопки ответа (Q-103): текст кончается описанием.
    expect(result.body).toBe(
      'Рейд\nТип: PvE\nКогда: 14.11.2099 20:00 МСК\n\nСобираемся у портала',
    )
    expect(result.recipients).toBeNull()
    await closeEvent(deps, officer.actor, { id: event.id })
    await rejects(
      prefillBroadcast(deps, officer.actor, { source: 'event', id: event.id }),
      'state_conflict',
    )
  })

  it('fills from an active vote and rejects a closed one', async () => {
    const officer = await roleActor('officer')
    const vote = await createVote(deps, officer.actor, {
      title: 'Куда идём?',
      context: 'Выбираем подземелье',
      options: ['Башня', 'Пещера'],
    })
    const result = await prefillBroadcast(deps, officer.actor, {
      source: 'vote',
      id: vote.id,
    })
    expect(result.subject).toBe('Голосование: Куда идём?')
    expect(result.body).toContain('Выбираем подземелье')
    expect(result.body).toContain('на сайте')
    expect(result.body).toContain('кнопкой ниже')
    expect(result.bodyLimit).toBeLessThan(BROADCAST_LIMITS.body)
    await closeVote(deps, officer.actor, { id: vote.id })
    await rejects(
      prefillBroadcast(deps, officer.actor, { source: 'vote', id: vote.id }),
      'state_conflict',
    )
  })

  it('sends verified vote options to linked members, including voters, in one audit entry', async () => {
    const officer = await roleActor('officer')
    const member = await createProfiledUser(db, 'member')
    await db
      .insertInto('app.telegram_links')
      .values({
        user_id: member.id,
        telegram_user_id: 81001,
        chat_id: 81001,
        display_name: member.nickname,
      })
      .execute()
    const fake = fakeTelegram()
    const sendDeps = { ...deps, telegram: fake.telegram }
    const vote = await createVote(deps, officer.actor, {
      title: 'Куда идём?',
      context: '',
      options: ['Башня', 'Пещера'],
    })
    await castBallot(
      { ...sendDeps, telegram: null },
      await actorOf(db, member.id),
      {
        voteId: vote.id,
        optionId: vote.options[0]!.id,
      },
    )

    const result = await sendAnnouncement(sendDeps, officer.actor, {
      subject: 'Куда идём?',
      body: 'Выберите ответ кнопкой ниже или на сайте.',
      voteId: vote.id,
      channels: ['telegram'],
    })

    expect(result).toMatchObject({ recipients: 1, sent: 1, failed: 0 })
    const message = fake.calls.find((call) => call.method === 'sendHtml')!
    expect(message.text).toContain('Ваш голос: Башня')
    expect(message.keyboard).toEqual({
      inline_keyboard: [[{ text: 'Изменить решение', callback_data: 'vc' }]],
    })
    expect(await auditActions()).toMatchObject([
      expect.objectContaining({
        action: 'broadcast_sent',
        details: expect.objectContaining({
          vote_id: vote.id,
          source_kind: 'vote',
        }),
      }),
    ])

    await sendAnnouncement(sendDeps, officer.actor, {
      body: 'Обычное сообщение',
      channels: ['telegram'],
    })
    expect(fake.calls.at(-1)).toMatchObject({
      method: 'sendHtml',
      keyboard: null,
    })
    expect(await auditActions()).toHaveLength(2)
  })

  it('rejects a vote message whose option list exceeds the common channel limit', async () => {
    const officer = await roleActor('officer')
    const fake = fakeTelegram()
    const sendDeps = { ...deps, telegram: fake.telegram }
    const vote = await createVote(deps, officer.actor, {
      title: 'Куда идём?',
      context: '',
      options: Array.from(
        { length: 10 },
        (_, index) => `${index}${'А'.repeat(79)}`,
      ),
    })
    const prefill = await prefillBroadcast(deps, officer.actor, {
      source: 'vote',
      id: vote.id,
    })
    expect(prefill.bodyLimit).toBeDefined()
    await rejects(
      sendAnnouncement(sendDeps, officer.actor, {
        subject: prefill.subject,
        body: 'x'.repeat(prefill.bodyLimit! + 1),
        voteId: vote.id,
        channels: ['telegram'],
      }),
      'validation_failed',
    )
    expect(fake.calls).toEqual([])
    expect(await auditActions()).toEqual([])
  })

  it('lists a non-empty group in order with the leader', async () => {
    const officer = await roleActor('officer')
    const a = await roleActor('member')
    const b = await roleActor('member')
    const event = await createEvent(deps, officer.actor, eventFields)
    const { groups } = await createGroup(deps, officer.actor, {
      eventId: event.id,
      name: 'Пати',
    })
    const groupId = groups[0]!.id
    await rejects(
      prefillBroadcast(deps, officer.actor, { source: 'group', id: groupId }),
      'state_conflict',
    )
    for (const user of [a, b]) {
      await moveMember(deps, officer.actor, {
        eventId: event.id,
        userId: user.user.id,
        groupId,
      })
    }
    await setGroupLeader(deps, officer.actor, { groupId, userId: b.user.id })
    const result = await prefillBroadcast(deps, officer.actor, {
      source: 'group',
      id: groupId,
    })
    expect(result.recipients).toEqual([
      { gameNickname: a.user.nickname, isLeader: false },
      { gameNickname: b.user.nickname, isLeader: true },
    ])
    expect(result.body).toContain(`2. ${b.user.nickname} — лидер`)
    expect(result.body).toContain('Получателей: 2.')
    await rejects(
      prefillBroadcast(deps, officer.actor, {
        source: 'group',
        id: '00000000-0000-0000-0000-000000000000',
      }),
      'not_found',
    )
  })
})
