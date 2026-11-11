import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getMe } from '../../supabase/functions/_shared/account/service.ts'
import { applicationRepository } from '../../supabase/functions/_shared/applications/repository.ts'
import {
  decideApplication,
  getApplication,
  listApplications,
  resubmitApplication,
} from '../../supabase/functions/_shared/applications/service.ts'
import {
  GUEST,
  type Actor,
} from '../../supabase/functions/_shared/auth/actor.ts'
import type { AccessRole } from '../../supabase/functions/_shared/contracts/account.ts'
import { APPLICATION_PAGE_SIZE } from '../../supabase/functions/_shared/contracts/applications.ts'
import { moscowDate } from '../../supabase/functions/_shared/membership.ts'
import {
  actorOf,
  createAuthUser,
  createProfiledUser,
  resetAppData,
  testDb,
  testDeps,
  uploadAvatar,
} from './support.ts'

const db = testDb()
const deps = testDeps(db)

beforeEach(() => resetAppData(db))
afterAll(() => db.destroy())

const rejects = (promise: Promise<unknown>, code: string) =>
  expect(promise).rejects.toMatchObject({ code })

async function roleActor(role: AccessRole) {
  const user = await createProfiledUser(db, role)
  return { user, actor: await actorOf(db, user.id) }
}

/** Кандидат с заполненным профилем и заявкой (фикстура в обход сервиса). */
async function createApplicant(
  options: { links?: string[]; submittedAt?: string } = {},
) {
  const user = await createProfiledUser(db, 'applicant')
  await db
    .updateTable('app.profiles')
    .set({
      city: 'Казань',
      birth_date: '1990-01-02',
      about: 'Рассказ кандидата',
    })
    .where('id', '=', user.id)
    .execute()
  const applicationId = await applicationRepository.create(
    db,
    user.id,
    options.links ?? ['https://example.com/a.png'],
  )
  if (options.submittedAt) {
    await db
      .updateTable('app.join_applications')
      .set({ submitted_at: options.submittedAt })
      .where('id', '=', applicationId)
      .execute()
  }
  return { user, applicationId, actor: () => actorOf(db, user.id) }
}

async function profile(id: string) {
  return db
    .selectFrom('app.profiles')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow()
}
async function application(id: string) {
  return db
    .selectFrom('app.join_applications')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow()
}
async function auditActions() {
  const rows = await db
    .selectFrom('app.audit_log')
    .select('action')
    .orderBy('id')
    .execute()
  return rows.map((row) => row.action)
}
async function notifications(recipientId: string) {
  return db
    .selectFrom('app.user_notifications')
    .selectAll()
    .where('recipient_id', '=', recipientId)
    .execute()
}

describe('access matrix', () => {
  const calls = (actor: Actor, id: string) => [
    listApplications(deps, actor, { tab: 'new' }),
    getApplication(deps, actor, { id }),
    decideApplication(deps, actor, { id, decision: 'accept' }),
  ]

  it('rejects a guest and a user without a profile', async () => {
    const { applicationId } = await createApplicant()
    for (const call of calls(GUEST, applicationId)) {
      await rejects(call, 'not_authenticated')
    }
    await rejects(
      resubmitApplication(deps, GUEST, { equipmentLinks: [] }),
      'not_authenticated',
    )
    const incomplete = await actorOf(db, (await createAuthUser()).id)
    for (const call of calls(incomplete, applicationId)) {
      await rejects(call, 'registration_incomplete')
    }
  })

  it('closes review to applicants, readers and members (APP-03, ACL-02)', async () => {
    const { applicationId, actor } = await createApplicant()
    const actors = [
      await actor(),
      (await roleActor('reader')).actor,
      (await roleActor('member')).actor,
    ]
    for (const reviewer of actors) {
      for (const call of calls(reviewer, applicationId)) {
        await rejects(call, 'forbidden')
      }
    }
    expect((await application(applicationId)).status).toBe(
      'pending_officer_review',
    )
  })

  it('lets only applicants resubmit', async () => {
    for (const role of ['reader', 'member', 'officer', 'admin'] as const) {
      const { actor } = await roleActor(role)
      await rejects(
        resubmitApplication(deps, actor, { equipmentLinks: [] }),
        'forbidden',
      )
    }
  })
})

describe('queue', () => {
  it('lists new applications oldest first with the new count', async () => {
    const later = await createApplicant({ submittedAt: '2026-11-10T10:00:00Z' })
    const earlier = await createApplicant({
      submittedAt: '2026-11-09T10:00:00Z',
    })
    const { actor } = await roleActor('officer')
    const result = await listApplications(deps, actor, { tab: 'new' })
    expect(result.items.map((item) => item.id)).toEqual([
      earlier.applicationId,
      later.applicationId,
    ])
    expect(result).toMatchObject({ newCount: 2, hasMore: false, page: 0 })
    expect(result.items[0]?.applicant).toEqual({
      id: earlier.user.id,
      gameNickname: earlier.user.nickname,
      classId: 1,
      className: 'Оборотень',
      avatarUrl: null,
    })
  })

  it('signs avatars of the listed applicants', async () => {
    const { user } = await createApplicant()
    const path = await uploadAvatar(deps, user.id)
    await db
      .updateTable('app.profiles')
      .set({ avatar_path: path })
      .where('id', '=', user.id)
      .execute()
    const { actor } = await roleActor('admin')
    const result = await listApplications(deps, actor, { tab: 'new' })
    expect(result.items[0]?.applicant.avatarUrl).toMatch(/^http/)
  })

  it('pages decided applications, latest decision first', async () => {
    const { actor } = await roleActor('officer')
    const ids: string[] = []
    for (let n = 0; n <= APPLICATION_PAGE_SIZE; n += 1) {
      const { applicationId } = await createApplicant()
      await decideApplication(deps, actor, {
        id: applicationId,
        decision: n % 2 ? 'accept' : 'reject',
      })
      ids.push(applicationId)
    }
    const first = await listApplications(deps, actor, { tab: 'decided' })
    expect(first.items).toHaveLength(APPLICATION_PAGE_SIZE)
    expect(first.hasMore).toBe(true)
    expect(first.items[0]?.id).toBe(ids.at(-1))
    const second = await listApplications(deps, actor, {
      tab: 'decided',
      page: 1,
    })
    expect(second.items.map((item) => item.id)).toEqual([ids[0]])
    expect(second.hasMore).toBe(false)
    expect(second.newCount).toBe(0)
  })
})

describe('application card', () => {
  it('hides email, city and birth date from an officer (APP-03)', async () => {
    const { applicationId, user } = await createApplicant({
      links: ['https://example.com/1.png', 'https://example.com/2.png'],
    })
    const { actor } = await roleActor('officer')
    const details = await getApplication(deps, actor, { id: applicationId })
    expect(details).not.toHaveProperty('contacts')
    const json = JSON.stringify(details)
    expect(json).not.toContain(user.email)
    expect(json).not.toContain('Казань')
    expect(json).not.toContain('1990-01-02')
    expect(details).toMatchObject({
      status: 'pending_officer_review',
      equipmentLinks: [
        'https://example.com/1.png',
        'https://example.com/2.png',
      ],
      applicant: {
        displayName: 'Тест',
        gameNickname: user.nickname,
        about: 'Рассказ кандидата',
      },
    })
  })

  it('shows all data to an administrator', async () => {
    const { applicationId, user } = await createApplicant()
    const { actor } = await roleActor('admin')
    const details = await getApplication(deps, actor, { id: applicationId })
    expect(details.contacts).toEqual({
      email: user.email,
      city: 'Казань',
      birthDate: '1990-01-02',
    })
  })

  it('reports an unknown application as not found', async () => {
    const { actor } = await roleActor('officer')
    await rejects(
      getApplication(deps, actor, { id: crypto.randomUUID() }),
      'not_found',
    )
  })
})

describe('direct decision', () => {
  it('accepts: member role, join date, notification and audit (E2E-02)', async () => {
    const { applicationId, user, actor } = await createApplicant({
      links: ['https://example.com/gear.png'],
    })
    const officer = await roleActor('officer')
    const details = await decideApplication(deps, officer.actor, {
      id: applicationId,
      decision: 'accept',
      note: '  Проверен в игре  ',
    })
    expect(details).toMatchObject({
      status: 'officer_approved',
      decisionNote: 'Проверен в игре',
      decidedBy: { gameNickname: officer.user.nickname },
      // Ссылки остаются в истории заявки (APP-12).
      equipmentLinks: ['https://example.com/gear.png'],
    })
    expect(await profile(user.id)).toMatchObject({
      access_role: 'member',
      joined_on: moscowDate(new Date()),
    })
    expect(await application(applicationId)).toMatchObject({
      decided_by: officer.user.id,
      decided_at: expect.any(String),
    })
    expect(await notifications(user.id)).toMatchObject([
      {
        kind: 'application_accepted',
        actor_id: officer.user.id,
        target_id: applicationId,
      },
    ])
    expect(await auditActions()).toEqual(['application_accepted_directly'])
    const me = await getMe(deps, await actor())
    expect(me).toMatchObject({
      profile: { role: 'member' },
      application: { status: 'officer_approved' },
      canResubmit: false,
    })
  })

  it('rejects: role unchanged, notification and audit (APP-10)', async () => {
    const { applicationId, user, actor } = await createApplicant()
    const admin = await roleActor('admin')
    await decideApplication(deps, admin.actor, {
      id: applicationId,
      decision: 'reject',
    })
    expect(await profile(user.id)).toMatchObject({
      access_role: 'applicant',
      joined_on: null,
    })
    // Прямое решение — статус officer_*, даже если решал администратор.
    expect((await application(applicationId)).status).toBe('officer_rejected')
    expect(await notifications(user.id)).toMatchObject([
      { kind: 'application_rejected' },
    ])
    expect(await auditActions()).toEqual(['application_rejected'])
    expect(await getMe(deps, await actor())).toMatchObject({
      application: { status: 'officer_rejected' },
      canResubmit: true,
    })
  })

  it('refuses a second decision with state_conflict', async () => {
    const { applicationId } = await createApplicant()
    const { actor } = await roleActor('officer')
    await decideApplication(deps, actor, {
      id: applicationId,
      decision: 'reject',
    })
    await rejects(
      decideApplication(deps, actor, { id: applicationId, decision: 'accept' }),
      'state_conflict',
    )
  })

  it('lets only one of two parallel decisions win', async () => {
    const { applicationId, user } = await createApplicant()
    const first = await roleActor('officer')
    const second = await roleActor('admin')
    const results = await Promise.allSettled([
      decideApplication(deps, first.actor, {
        id: applicationId,
        decision: 'accept',
      }),
      decideApplication(deps, second.actor, {
        id: applicationId,
        decision: 'reject',
      }),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const failed = results.find((r) => r.status === 'rejected')
    expect(failed?.reason).toMatchObject({ code: 'state_conflict' })
    expect(await notifications(user.id)).toHaveLength(1)
    expect(await auditActions()).toHaveLength(1)
  })

  it('rolls everything back when the applicant role changed meanwhile', async () => {
    const { applicationId, user } = await createApplicant()
    await db
      .updateTable('app.profiles')
      .set({ access_role: 'reader' })
      .where('id', '=', user.id)
      .execute()
    const { actor } = await roleActor('officer')
    await rejects(
      decideApplication(deps, actor, { id: applicationId, decision: 'accept' }),
      'state_conflict',
    )
    expect((await application(applicationId)).status).toBe(
      'pending_officer_review',
    )
    expect(await notifications(user.id)).toHaveLength(0)
    expect(await auditActions()).toEqual([])
  })

  it('validates the note length and an unknown application', async () => {
    const { applicationId } = await createApplicant()
    const { actor } = await roleActor('officer')
    await expect(
      decideApplication(deps, actor, {
        id: applicationId,
        decision: 'reject',
        note: 'x'.repeat(1001),
      }),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      fields: { note: 'too_long' },
    })
    await rejects(
      decideApplication(deps, actor, {
        id: crypto.randomUUID(),
        decision: 'reject',
      }),
      'not_found',
    )
  })
})

describe('resubmission after rejection', () => {
  async function rejectedApplicant() {
    const applicant = await createApplicant({
      links: ['https://example.com/old.png'],
    })
    const { actor } = await roleActor('officer')
    await decideApplication(deps, actor, {
      id: applicant.applicationId,
      decision: 'reject',
    })
    return applicant
  }

  it('creates a new application without copying old links (Q-37)', async () => {
    const { user, actor, applicationId } = await rejectedApplicant()
    const me = await resubmitApplication(deps, await actor(), {
      equipmentLinks: ['https://example.com/new.png', ''],
    })
    expect(me).toMatchObject({
      application: { status: 'pending_officer_review' },
      canResubmit: false,
    })
    if (me.state !== 'ready' || !me.application) throw new Error('нет заявки')
    expect(me.application.id).not.toBe(applicationId)
    expect(await applicationRepository.links(db, me.application.id)).toEqual([
      'https://example.com/new.png',
    ])
    // История прежней заявки не меняется (APP-12).
    expect(await applicationRepository.links(db, applicationId)).toEqual([
      'https://example.com/old.png',
    ])
    expect(await auditActions()).toEqual([
      'application_rejected',
      'application_resubmitted',
    ])
    expect((await profile(user.id)).access_role).toBe('applicant')
  })

  it('refuses while an application is active (Q-06)', async () => {
    const { actor } = await createApplicant()
    await rejects(
      resubmitApplication(deps, await actor(), { equipmentLinks: [] }),
      'state_conflict',
    )
    expect(await getMe(deps, await actor())).toMatchObject({
      canResubmit: false,
    })
  })

  it('accepts only one of two parallel submissions', async () => {
    const { actor, user } = await rejectedApplicant()
    const current = await actor()
    const results = await Promise.allSettled([
      resubmitApplication(deps, current, { equipmentLinks: [] }),
      resubmitApplication(deps, current, { equipmentLinks: [] }),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const active = await db
      .selectFrom('app.join_applications')
      .select('id')
      .where('applicant_id', '=', user.id)
      .where('status', '=', 'pending_officer_review')
      .execute()
    expect(active).toHaveLength(1)
  })

  it('rejects 11 links in a direct request (APP-13)', async () => {
    const { actor } = await rejectedApplicant()
    await expect(
      resubmitApplication(deps, await actor(), {
        equipmentLinks: Array.from(
          { length: 11 },
          (_, n) => `https://example.com/${n}.png`,
        ),
      }),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      fields: { equipmentLinks: 'too_many' },
    })
  })

  it('requires the profile fields cleared after registration', async () => {
    const { actor, user } = await rejectedApplicant()
    await db
      .updateTable('app.profiles')
      .set({ city: null, about: null })
      .where('id', '=', user.id)
      .execute()
    await expect(
      resubmitApplication(deps, await actor(), { equipmentLinks: [] }),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      fields: { city: 'required', about: 'required' },
    })
  })
})
