import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppDeps } from '../../supabase/functions/_shared/app.ts'
import { GUEST } from '../../supabase/functions/_shared/auth/actor.ts'
import {
  deleteBroadcastTemplate,
  deleteDraft,
  listBroadcastTemplates,
  listDrafts,
  prefillBroadcast,
  saveBroadcastTemplate,
  saveDraft,
} from '../../supabase/functions/_shared/broadcasts/service.ts'
import type { AccessRole } from '../../supabase/functions/_shared/contracts/account.ts'
import { BROADCAST_LIMITS } from '../../supabase/functions/_shared/contracts/broadcasts.ts'
import {
  closeEvent,
  createEvent,
} from '../../supabase/functions/_shared/events/service.ts'
import {
  createGroup,
  moveMember,
  setGroupLeader,
} from '../../supabase/functions/_shared/groups/service.ts'
import {
  closeVote,
  createVote,
} from '../../supabase/functions/_shared/votes/service.ts'
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
  attachments: [{ name: 'plan.xlsx', size: 1024, type: '' }],
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
  })
})

describe('broadcasts: drafts (BRC-06–09, BRC-12, Q-69–Q-71)', () => {
  it('saves a shared draft with metadata only and audits it', async () => {
    const officer = await roleActor('officer')
    const other = await roleActor('officer')
    const { items } = await saveDraft(deps, officer.actor, draft())
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      subject: 'Сбор',
      body: 'Сегодня рейд',
      channels: ['telegram', 'vk', 'max'],
      attachments: [{ name: 'plan.xlsx', size: 1024, type: '' }],
      author: { gameNickname: officer.user.nickname },
      canDelete: true,
    })
    const shared = await listDrafts(deps, other.actor)
    expect(shared.items[0]!.canDelete).toBe(false)
    expect(await auditActions()).toEqual([
      expect.objectContaining({ action: 'broadcast_draft_saved' }),
    ])
  })

  it('validates text, channels and attachments', async () => {
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
      draft({ attachments: [{ name: 'a.exe', size: 1, type: '' }] }),
      'attachments.0.name',
    )
    await invalid(
      draft({
        attachments: [
          { name: 'a.png', size: BROADCAST_LIMITS.fileBytes + 1, type: '' },
        ],
      }),
      'attachments.0.size',
    )
    await invalid(
      draft({
        attachments: Array.from({ length: 11 }, (_, i) => ({
          name: `f${i}.txt`,
          size: 1,
          type: 'text/plain',
        })),
      }),
      'attachments',
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
    expect(result.body).toContain('Тип: PvE')
    expect(result.body).toContain('14.11.2099 20:00 МСК')
    expect(result.body).toContain('Собираемся у портала')
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
    await closeVote(deps, officer.actor, { id: vote.id })
    await rejects(
      prefillBroadcast(deps, officer.actor, { source: 'vote', id: vote.id }),
      'state_conflict',
    )
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
