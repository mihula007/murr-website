import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getMe } from '../../supabase/functions/_shared/account/service.ts'
import { applicationRepository } from '../../supabase/functions/_shared/applications/repository.ts'
import {
  decideApplication,
  finalDecideApplication,
  getApplication,
  listApplications,
  submitApplicationToVote,
} from '../../supabase/functions/_shared/applications/service.ts'
import {
  GUEST,
  type Actor,
} from '../../supabase/functions/_shared/auth/actor.ts'
import type { AccessRole } from '../../supabase/functions/_shared/contracts/account.ts'
import { SMALL_LIST_LIMIT } from '../../supabase/functions/_shared/contracts/paging.ts'
import { moscowDate } from '../../supabase/functions/_shared/membership.ts'
import {
  castBallot,
  closeVote,
  createVote,
  deleteVote,
  getVote,
  listVotes,
  updateVote,
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
const deps = testDeps(db)

beforeEach(() => resetAppData(db))
afterAll(() => db.destroy())

const rejects = (promise: Promise<unknown>, code: string) =>
  expect(promise).rejects.toMatchObject({ code })

async function roleActor(role: AccessRole) {
  const user = await createProfiledUser(db, role)
  return { user, actor: await actorOf(db, user.id) }
}

const general = (overrides: Record<string, unknown> = {}) => ({
  title: 'Куда идём в субботу?',
  context: 'Выбираем подземелье',
  options: ['Башня', 'Пещера', 'Болото'],
  ...overrides,
})

async function createGeneral(actor: Actor, overrides = {}) {
  return createVote(deps, actor, general(overrides))
}

async function createApplicant() {
  const user = await createProfiledUser(db, 'applicant')
  const applicationId = await applicationRepository.create(db, user.id, [
    'https://example.com/gear.png',
  ])
  return { user, applicationId, actor: () => actorOf(db, user.id) }
}

async function applicationStatus(id: string) {
  const row = await db
    .selectFrom('app.join_applications')
    .select('status')
    .where('id', '=', id)
    .executeTakeFirstOrThrow()
  return row.status
}

async function auditActions() {
  const rows = await db
    .selectFrom('app.audit_log')
    .select('action')
    .orderBy('id')
    .execute()
  return rows.map((row) => row.action)
}

const counts = (vote: { options: { label: string; count: number }[] }) =>
  Object.fromEntries(vote.options.map((option) => [option.label, option.count]))

describe('access matrix', () => {
  it('rejects a guest, a user without a profile and outsiders', async () => {
    const { actor: officer } = await roleActor('officer')
    const vote = await createGeneral(officer)
    const optionId = vote.options[0]!.id
    const calls = (actor: Actor) => [
      listVotes(deps, actor, { tab: 'active' }),
      getVote(deps, actor, { id: vote.id }),
      castBallot(deps, actor, { voteId: vote.id, optionId }),
      createVote(deps, actor, general()),
      updateVote(deps, actor, { id: vote.id, title: 'Т', context: '' }),
      closeVote(deps, actor, { id: vote.id }),
      deleteVote(deps, actor, { id: vote.id }),
    ]
    for (const call of calls(GUEST)) {
      await rejects(call, 'not_authenticated')
    }
    const incomplete = await actorOf(db, (await createAuthUser()).id)
    for (const call of calls(incomplete)) {
      await rejects(call, 'registration_incomplete')
    }
    // Кандидат и чтец не видят голосований (ACL-02, ACL-06).
    for (const role of ['applicant', 'reader'] as const) {
      const { actor } = await roleActor(role)
      for (const call of calls(actor)) {
        await rejects(call, 'forbidden')
      }
    }
    expect((await getVote(deps, officer, { id: vote.id })).closedAt).toBeNull()
  })

  it('lets members read and vote but not manage (ACL-04)', async () => {
    const { actor: officer } = await roleActor('officer')
    const { actor: member } = await roleActor('member')
    const vote = await createGeneral(officer)
    await rejects(createVote(deps, member, general()), 'forbidden')
    await rejects(
      updateVote(deps, member, { id: vote.id, title: 'Т', context: '' }),
      'forbidden',
    )
    await rejects(closeVote(deps, member, { id: vote.id }), 'forbidden')
    await rejects(deleteVote(deps, member, { id: vote.id }), 'forbidden')
    const result = await castBallot(deps, member, {
      voteId: vote.id,
      optionId: vote.options[1]!.id,
    })
    expect(result.myOptionId).toBe(vote.options[1]!.id)
  })

  it('shows ballots only to officers and admins (VOT-07, Q-16)', async () => {
    const { actor: admin } = await roleActor('admin')
    const { user: memberUser, actor: member } = await roleActor('member')
    const vote = await createGeneral(admin)
    await castBallot(deps, member, {
      voteId: vote.id,
      optionId: vote.options[0]!.id,
    })
    const forMember = await getVote(deps, member, { id: vote.id })
    expect(forMember).not.toHaveProperty('ballots')
    expect(forMember).not.toHaveProperty('ballotsTruncated')
    const forAdmin = await getVote(deps, admin, { id: vote.id })
    expect(forAdmin.ballots).toEqual([
      { gameNickname: memberUser.nickname, optionId: vote.options[0]!.id },
    ])
    expect(forAdmin.ballotsTruncated).toBe(false)
  })
})

describe('creation rules (VOT-02, VOT-03)', () => {
  it('accepts 2 and 10 options and rejects 1 and 11', async () => {
    const { actor } = await roleActor('officer')
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => `Вариант ${i + 1}`)
    await expect(
      createGeneral(actor, { options: many(2) }),
    ).resolves.toMatchObject({ options: expect.any(Array) })
    expect(
      (await createGeneral(actor, { options: many(10) })).options,
    ).toHaveLength(10)
    await expect(
      createGeneral(actor, { options: many(1) }),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      fields: { options: 'too_few' },
    })
    await expect(
      createGeneral(actor, { options: many(11) }),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      fields: { options: 'too_many' },
    })
  })

  it('rejects empty and case-insensitive duplicate options', async () => {
    const { actor } = await roleActor('admin')
    await expect(
      createGeneral(actor, { options: ['Да', '  '] }),
    ).rejects.toMatchObject({ fields: { 'options.1': 'required' } })
    await expect(
      createGeneral(actor, { options: ['Да', ' да '] }),
    ).rejects.toMatchObject({ fields: { 'options.1': 'duplicate' } })
    await expect(createGeneral(actor, { title: ' ' })).rejects.toMatchObject({
      fields: { title: 'required' },
    })
    await expect(
      createGeneral(actor, { title: 'x'.repeat(121) }),
    ).rejects.toMatchObject({ fields: { title: 'too_long' } })
    expect(await auditActions()).toEqual([])
  })

  it('trims options and records the creation in the audit', async () => {
    const { actor } = await roleActor('officer')
    const vote = await createGeneral(actor, { options: [' Да ', 'Нет'] })
    expect(vote).toMatchObject({
      kind: 'general',
      title: 'Куда идём в субботу?',
      context: 'Выбираем подземелье',
      closedAt: null,
      applicant: null,
      totalBallots: 0,
      myOptionId: null,
    })
    expect(vote.options.map((option) => option.label)).toEqual(['Да', 'Нет'])
    expect(vote.options.every((option) => !option.leading)).toBe(true)
    expect(await auditActions()).toEqual(['vote_created'])
  })
})

describe('ballots (VOT-05, VOT-06)', () => {
  it('keeps one ballot per member and moves it on change', async () => {
    const { actor: officer } = await roleActor('officer')
    const { actor: first } = await roleActor('member')
    const { actor: second } = await roleActor('member')
    const vote = await createGeneral(officer)
    const [a, b] = vote.options
    await castBallot(deps, first, { voteId: vote.id, optionId: a!.id })
    await castBallot(deps, second, { voteId: vote.id, optionId: a!.id })
    // Повтор того же выбора и смена решения не увеличивают итог.
    await castBallot(deps, first, { voteId: vote.id, optionId: a!.id })
    const changed = await castBallot(deps, first, {
      voteId: vote.id,
      optionId: b!.id,
    })
    expect(changed.totalBallots).toBe(2)
    expect(counts(changed)).toEqual({ Башня: 1, Пещера: 1, Болото: 0 })
    expect(changed.myOptionId).toBe(b!.id)
    const reread = await getVote(deps, first, { id: vote.id })
    expect(reread.myOptionId).toBe(b!.id)
    expect(reread.options.filter((o) => o.leading)).toHaveLength(2)
    // Голос не пишется в аудит (Q-41).
    expect(await auditActions()).toEqual(['vote_created'])
  })

  it('rejects an option of another vote', async () => {
    const { actor } = await roleActor('officer')
    const one = await createGeneral(actor)
    const other = await createGeneral(actor)
    await rejects(
      castBallot(deps, actor, {
        voteId: one.id,
        optionId: other.options[0]!.id,
      }),
      'not_found',
    )
  })

  it('serializes a ballot with a concurrent close', async () => {
    const { actor: officer } = await roleActor('officer')
    const { actor: member } = await roleActor('member')
    const vote = await createGeneral(officer)
    const results = await Promise.allSettled([
      castBallot(deps, member, {
        voteId: vote.id,
        optionId: vote.options[0]!.id,
      }),
      closeVote(deps, officer, { id: vote.id }),
    ])
    const closed = await getVote(deps, officer, { id: vote.id })
    expect(closed.closedAt).not.toBeNull()
    // Либо голос успел до завершения и учтён, либо отклонён и не учтён.
    const outcome =
      results[0].status === 'rejected'
        ? { error: (results[0].reason as { code: string }).code, ballots: 0 }
        : { error: null, ballots: 1 }
    expect(closed.totalBallots).toBe(outcome.ballots)
    expect([null, 'state_conflict']).toContain(outcome.error)
  })
})

describe('management', () => {
  it('edits title and context and keeps ballots (VOT-08)', async () => {
    const { actor: officer } = await roleActor('officer')
    const { actor: member } = await roleActor('member')
    const vote = await createGeneral(officer)
    await castBallot(deps, member, {
      voteId: vote.id,
      optionId: vote.options[0]!.id,
    })
    const updated = await updateVote(deps, officer, {
      id: vote.id,
      title: 'Новая тема',
      context: '',
    })
    expect(updated).toMatchObject({
      title: 'Новая тема',
      context: '',
      totalBallots: 1,
    })
    expect(await auditActions()).toEqual(['vote_created', 'vote_updated'])
  })

  it('closes into history and freezes the vote (VOT-09, VOT-12, Q-40)', async () => {
    const { actor: officer } = await roleActor('officer')
    const { actor: member } = await roleActor('member')
    const vote = await createGeneral(officer)
    // Без голосов: кворума нет (Q-40).
    const closed = await closeVote(deps, officer, { id: vote.id })
    expect(closed.closedAt).not.toBeNull()
    const active = await listVotes(deps, member, { tab: 'active' })
    expect(active.items).toEqual([])
    expect(active.activeCount).toBe(0)
    const history = await listVotes(deps, member, { tab: 'history' })
    expect(history.items.map((item) => item.id)).toEqual([vote.id])
    const optionId = vote.options[0]!.id
    for (const call of [
      () => castBallot(deps, member, { voteId: vote.id, optionId }),
      () => updateVote(deps, officer, { id: vote.id, title: 'Т', context: '' }),
      () => closeVote(deps, officer, { id: vote.id }),
      () => deleteVote(deps, officer, { id: vote.id }),
    ]) {
      await rejects(call(), 'state_conflict')
    }
    expect(await auditActions()).toEqual(['vote_created', 'vote_closed'])
  })

  it('deletes an active vote with its ballots (VOT-11)', async () => {
    const { actor: admin } = await roleActor('admin')
    const { actor: member } = await roleActor('member')
    const vote = await createGeneral(admin)
    await castBallot(deps, member, {
      voteId: vote.id,
      optionId: vote.options[0]!.id,
    })
    await deleteVote(deps, admin, { id: vote.id })
    await rejects(getVote(deps, member, { id: vote.id }), 'not_found')
    const ballots = await db
      .selectFrom('app.vote_ballots')
      .select('id')
      .where('vote_id', '=', vote.id)
      .execute()
    expect(ballots).toEqual([])
    expect(await auditActions()).toEqual(['vote_created', 'vote_deleted'])
  })
})

describe('lists', () => {
  it('pages history by cursor, latest close first', async () => {
    const { actor } = await roleActor('officer')
    const ids: string[] = []
    for (let n = 0; n < 5; n += 1) {
      const vote = await createGeneral(actor)
      await closeVote(deps, actor, { id: vote.id })
      ids.push(vote.id)
    }
    const seen: string[] = []
    let cursor: string | null = null
    do {
      const page = await listVotes(deps, actor, {
        tab: 'history',
        limit: 2,
        cursor,
      })
      seen.push(...page.items.map((item) => item.id))
      cursor = page.nextCursor
    } while (cursor)
    expect(seen).toEqual([...ids].reverse())
  })

  it('caps active votes at the small-list limit and says so', async () => {
    const { user, actor } = await roleActor('officer')
    const rows = Array.from({ length: SMALL_LIST_LIMIT + 1 }, (_, n) => ({
      kind: 'general',
      title: `Голосование ${n}`,
      created_by: user.id,
    }))
    await db.insertInto('app.votes').values(rows).execute()
    const result = await listVotes(deps, actor, { tab: 'active' })
    expect(result.items).toHaveLength(SMALL_LIST_LIMIT)
    expect(result).toMatchObject({
      truncated: true,
      activeCount: SMALL_LIST_LIMIT + 1,
    })
  })
})

describe('application voting (APP-05, 07, 08, 11)', () => {
  it('runs E2E-01 on the service level', async () => {
    const { user: candidate, applicationId, actor } = await createApplicant()
    const { actor: officer } = await roleActor('officer')
    const { actor: admin } = await roleActor('admin')
    const { actor: member } = await roleActor('member')

    const submitted = await submitApplicationToVote(deps, officer, {
      id: applicationId,
    })
    expect(submitted.status).toBe('pending_vote')
    expect(submitted.vote?.options.map((o) => o.label)).toEqual([
      'За',
      'Против',
      'Воздержаться',
      'Конфликт',
    ])
    const queue = await listApplications(deps, officer, { tab: 'new' })
    expect(queue.items).toEqual([])

    const voteId = submitted.vote!.id
    const forMember = await getVote(deps, member, { id: voteId })
    expect(forMember).toMatchObject({
      kind: 'application',
      title: `Заявка: ${candidate.nickname}`,
      applicant: { gameNickname: candidate.nickname, className: 'Оборотень' },
    })
    expect(forMember).not.toHaveProperty('applicationId')
    // Кандидат не голосует и не видит голосование (ACL-02).
    await rejects(getVote(deps, await actor(), { id: voteId }), 'forbidden')

    const forOption = forMember.options[0]!.id
    await castBallot(deps, member, { voteId, optionId: forOption })
    await castBallot(deps, officer, { voteId, optionId: forOption })
    await closeVote(deps, officer, { id: voteId })

    // Большинство «За» не принимает автоматически (VOT-10).
    expect(await applicationStatus(applicationId)).toBe('vote_completed')
    const me = await getMe(deps, await actor())
    expect(me).toMatchObject({
      profile: { role: 'applicant' },
      application: { status: 'vote_completed' },
    })

    // Офицер окончательно не решает (APP-08).
    await rejects(
      finalDecideApplication(deps, officer, {
        id: applicationId,
        decision: 'accept',
      }),
      'forbidden',
    )
    await rejects(
      listApplications(deps, officer, { tab: 'final' }),
      'forbidden',
    )
    await rejects(
      decideApplication(deps, officer, {
        id: applicationId,
        decision: 'accept',
      }),
      'state_conflict',
    )

    const final = await listApplications(deps, admin, { tab: 'final' })
    expect(final.finalCount).toBe(1)
    expect(final.items[0]).toMatchObject({
      id: applicationId,
      vote: { id: voteId, totalBallots: 2 },
    })
    expect(counts(final.items[0]!.vote!)).toEqual({
      За: 2,
      Против: 0,
      Воздержаться: 0,
      Конфликт: 0,
    })

    const accepted = await finalDecideApplication(deps, admin, {
      id: applicationId,
      decision: 'accept',
    })
    expect(accepted.status).toBe('admin_approved')
    const profile = await db
      .selectFrom('app.profiles')
      .select(['access_role', 'joined_on'])
      .where('id', '=', candidate.id)
      .executeTakeFirstOrThrow()
    expect(profile).toEqual({
      access_role: 'member',
      joined_on: moscowDate(new Date()),
    })
    const notifications = await db
      .selectFrom('app.user_notifications')
      .select('kind')
      .where('recipient_id', '=', candidate.id)
      .execute()
    expect(notifications).toEqual([{ kind: 'application_accepted' }])
    expect(await auditActions()).toEqual([
      'application_submitted_to_vote',
      'vote_closed',
      'application_accepted_final',
    ])
    await rejects(
      finalDecideApplication(deps, admin, {
        id: applicationId,
        decision: 'reject',
      }),
      'state_conflict',
    )
  })

  it('rejects finally without changing the role', async () => {
    const { user, applicationId } = await createApplicant()
    const { actor: admin } = await roleActor('admin')
    const { vote } = await submitApplicationToVote(deps, admin, {
      id: applicationId,
    })
    await closeVote(deps, admin, { id: vote!.id })
    const result = await finalDecideApplication(deps, admin, {
      id: applicationId,
      decision: 'reject',
      note: 'Не сейчас',
    })
    expect(result).toMatchObject({
      status: 'admin_rejected',
      decisionNote: 'Не сейчас',
    })
    const profile = await db
      .selectFrom('app.profiles')
      .select('access_role')
      .where('id', '=', user.id)
      .executeTakeFirstOrThrow()
    expect(profile.access_role).toBe('applicant')
  })

  it('does not final-decide an application still under vote', async () => {
    const { applicationId } = await createApplicant()
    const { actor: admin } = await roleActor('admin')
    await submitApplicationToVote(deps, admin, { id: applicationId })
    await rejects(
      finalDecideApplication(deps, admin, {
        id: applicationId,
        decision: 'accept',
      }),
      'state_conflict',
    )
  })

  it('returns the application to the queue when its vote is deleted (APP-11)', async () => {
    const { applicationId } = await createApplicant()
    const { actor: officer } = await roleActor('officer')
    const { actor: member } = await roleActor('member')
    const first = await submitApplicationToVote(deps, officer, {
      id: applicationId,
    })
    await castBallot(deps, member, {
      voteId: first.vote!.id,
      optionId: first.vote!.options[0]!.id,
    })
    await deleteVote(deps, officer, { id: first.vote!.id })
    expect(await applicationStatus(applicationId)).toBe(
      'pending_officer_review',
    )
    const card = await getApplication(deps, officer, { id: applicationId })
    expect(card).not.toHaveProperty('vote')
    // Новое голосование начинается без старых голосов.
    const second = await submitApplicationToVote(deps, officer, {
      id: applicationId,
    })
    expect(second.vote?.totalBallots).toBe(0)
  })

  it('submits once even with two parallel requests', async () => {
    const { applicationId } = await createApplicant()
    const { actor: officer } = await roleActor('officer')
    const { actor: admin } = await roleActor('admin')
    const results = await Promise.allSettled([
      submitApplicationToVote(deps, officer, { id: applicationId }),
      submitApplicationToVote(deps, admin, { id: applicationId }),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const votes = await db
      .selectFrom('app.votes')
      .select('id')
      .where('application_id', '=', applicationId)
      .execute()
    expect(votes).toHaveLength(1)
  })

  it('keeps the linked vote title fixed', async () => {
    const { applicationId } = await createApplicant()
    const { actor: officer } = await roleActor('officer')
    const { vote } = await submitApplicationToVote(deps, officer, {
      id: applicationId,
    })
    const details = await getVote(deps, officer, { id: vote!.id })
    await expect(
      updateVote(deps, officer, {
        id: vote!.id,
        title: 'Другое',
        context: '',
      }),
    ).rejects.toMatchObject({ fields: { title: 'locked' } })
    const updated = await updateVote(deps, officer, {
      id: vote!.id,
      title: details.title,
      context: 'Обсуждаем до пятницы',
    })
    expect(updated.context).toBe('Обсуждаем до пятницы')
    expect(updated.applicationId).toBe(applicationId)
  })

  it('closes submission and final decision to members', async () => {
    const { applicationId } = await createApplicant()
    const { actor: member } = await roleActor('member')
    await rejects(
      submitApplicationToVote(deps, member, { id: applicationId }),
      'forbidden',
    )
    await rejects(
      finalDecideApplication(deps, member, {
        id: applicationId,
        decision: 'accept',
      }),
      'forbidden',
    )
    await rejects(
      submitApplicationToVote(deps, GUEST, { id: applicationId }),
      'not_authenticated',
    )
  })
})
