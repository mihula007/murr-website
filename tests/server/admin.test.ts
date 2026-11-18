import { sql } from 'kysely'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  getAccount,
  listAccounts,
  setPassword,
  setAccountProfile,
} from '../../supabase/functions/_shared/accounts/service.ts'
import type { AppDeps } from '../../supabase/functions/_shared/app.ts'
import { applicationRepository } from '../../supabase/functions/_shared/applications/repository.ts'
import { GUEST } from '../../supabase/functions/_shared/auth/actor.ts'
import { listAudit } from '../../supabase/functions/_shared/audit/service.ts'
import { saveDraft } from '../../supabase/functions/_shared/broadcasts/service.ts'
import type { AccessRole } from '../../supabase/functions/_shared/contracts/account.ts'
import {
  ACCOUNT_SORTS,
  type AccountListItem,
} from '../../supabase/functions/_shared/contracts/accounts.ts'
import {
  actorOf,
  createAuthUser,
  createProfiledUser,
  resetAppData,
  signIn,
  TEST_PASSWORD,
  testDb,
  testDeps,
} from './support.ts'
import { createTokenVerifier } from '../../supabase/functions/_shared/auth/token.ts'
import { env } from './support.ts'

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

async function nonAdmins() {
  const incomplete = await actorOf(db, (await createAuthUser()).id)
  const cases: [Parameters<typeof listAccounts>[1], string][] = [
    [GUEST, 'not_authenticated'],
    [incomplete, 'registration_incomplete'],
  ]
  for (const role of ['applicant', 'reader', 'member', 'officer'] as const) {
    cases.push([(await roleActor(role)).actor, 'forbidden'])
  }
  return cases
}

/** Все страницы списка по курсору. */
async function allPages(
  actor: Parameters<typeof listAccounts>[1],
  request: Record<string, unknown>,
) {
  const items: AccountListItem[] = []
  let cursor: string | null = null
  do {
    const page = await listAccounts(deps, actor, {
      ...request,
      cursor,
      limit: 2,
    })
    items.push(...page.items)
    cursor = page.nextCursor
  } while (cursor)
  return items
}

describe('admin: access (ADM, ACL-03)', () => {
  it('rejects every role except admin', async () => {
    const target = await roleActor('member')
    for (const [actor, code] of await nonAdmins()) {
      await rejects(listAccounts(deps, actor, {}), code)
      await rejects(getAccount(deps, actor, { userId: target.user.id }), code)
      await rejects(
        setPassword(deps, actor, {
          userId: target.user.id,
          password: 'new-password-1',
        }),
        code,
      )
      await rejects(listAudit(deps, actor, {}), code)
    }
  })
})

describe('admin: account search and sort (ADM-01, ADM-02)', () => {
  it('supports only nickname and registration sorts with cursors in both directions', async () => {
    const admin = await roleActor('admin')
    const profiles = [
      admin,
      await roleActor('officer'),
      await roleActor('member'),
      await roleActor('reader'),
      await roleActor('applicant'),
    ]
    for (const [index, item] of profiles.entries()) {
      await db
        .updateTable('app.profiles')
        .set({
          created_at:
            index < 3
              ? '2026-01-01T00:00:00Z'
              : `2026-01-0${index + 1}T00:00:00Z`,
        })
        .where('id', '=', item.user.id)
        .execute()
    }
    const ids = (
      await db.selectFrom('app.profiles').select('id').execute()
    ).map((row) => row.id)
    expect(ACCOUNT_SORTS).toEqual(['nickname', 'registered'])
    for (const sort of ACCOUNT_SORTS) {
      for (const direction of ['asc', 'desc'] as const) {
        const items = await allPages(admin.actor, { sort, direction })
        expect(items.map((item) => item.id).sort()).toEqual([...ids].sort())
      }
    }
    const registeredAsc = await allPages(admin.actor, {
      sort: 'registered',
      direction: 'asc',
    })
    const registeredDesc = await allPages(admin.actor, {
      sort: 'registered',
      direction: 'desc',
    })
    const registrationDates = new Map(
      profiles.map((item, index) => [
        item.user.id,
        index < 3 ? '2026-01-01T00:00:00Z' : `2026-01-0${index + 1}T00:00:00Z`,
      ]),
    )
    const expectedRegisteredAsc = [...profiles]
      .map((item) => item.user.id)
      .sort(
        (left, right) =>
          registrationDates
            .get(left)!
            .localeCompare(registrationDates.get(right)!) ||
          left.localeCompare(right),
      )
    expect(registeredAsc.map((item) => item.id)).toEqual(expectedRegisteredAsc)
    expect(registeredDesc.map((item) => item.id)).toEqual(
      expectedRegisteredAsc.reverse(),
    )
  })

  it('accepts legacy sort keys for already-open clients with cursor paging', async () => {
    const admin = await roleActor('admin')
    const profiles = [
      admin,
      await roleActor('member'),
      await roleActor('officer'),
      await roleActor('reader'),
    ]
    for (const sort of ['name', 'class', 'email', 'role', 'joined'] as const) {
      const items = await allPages(admin.actor, { sort })
      expect(items.map((item) => item.id).sort()).toEqual(
        profiles.map((item) => item.user.id).sort(),
      )
    }
  })

  it('applies class, role and search before count and cursor paging', async () => {
    const admin = await roleActor('admin')
    const eligible = [
      await roleActor('applicant'),
      await roleActor('applicant'),
    ]
    const wrongClass = await roleActor('applicant')
    const wrongRole = await roleActor('member')
    for (const [index, item] of eligible.entries()) {
      await db
        .updateTable('app.profiles')
        .set({ class_id: 2, game_nickname: `needle-${index ? 'b' : 'a'}` })
        .where('id', '=', item.user.id)
        .execute()
    }
    await db
      .updateTable('app.profiles')
      .set({ game_nickname: 'needle-c' })
      .where('id', '=', wrongClass.user.id)
      .execute()
    await db
      .updateTable('app.profiles')
      .set({ class_id: 2, game_nickname: 'needle-d' })
      .where('id', '=', wrongRole.user.id)
      .execute()

    const query = {
      search: 'needle',
      classId: 2,
      role: 'applicant',
      sort: 'nickname',
      direction: 'asc',
      limit: 1,
    } as const
    const first = await listAccounts(deps, admin.actor, query)
    const second = await listAccounts(deps, admin.actor, {
      ...query,
      cursor: first.nextCursor,
    })

    expect(first.total).toBe(2)
    expect(first.items.map((item) => item.gameNickname)).toEqual(['needle-a'])
    expect(first.nextCursor).not.toBeNull()
    expect(second.total).toBe(2)
    expect(second.items.map((item) => item.gameNickname)).toEqual(['needle-b'])
    expect(second.nextCursor).toBeNull()
  })

  it('rejects unsupported sort, role and class filter values', async () => {
    const admin = await roleActor('admin')
    await rejects(
      listAccounts(deps, admin.actor, { sort: 'not-supported' }),
      'validation_failed',
    )
    await rejects(
      listAccounts(deps, admin.actor, { role: 'not-a-role' }),
      'validation_failed',
    )
    await rejects(
      listAccounts(deps, admin.actor, { classId: 1.5 }),
      'validation_failed',
    )
    await rejects(
      listAccounts(deps, admin.actor, { classId: 32768 }),
      'validation_failed',
    )
  })

  it('searches nickname, name, email and class and counts the result', async () => {
    const admin = await roleActor('admin')
    const target = await roleActor('member')
    await db
      .updateTable('app.profiles')
      .set({ display_name: 'Ольга_%' })
      .where('id', '=', target.user.id)
      .execute()
    const search = async (value: string) =>
      listAccounts(deps, admin.actor, { search: value })
    expect((await search(target.user.nickname)).items.map((i) => i.id)).toEqual(
      [target.user.id],
    )
    expect((await search('ольга')).total).toBe(1)
    expect((await search(target.user.email.slice(0, 12))).total).toBe(1)
    // `%` и `_` ищутся как обычные символы.
    expect((await search('_%')).items.map((i) => i.id)).toEqual([
      target.user.id,
    ])
    expect((await search('%')).total).toBe(1)
    const className = (
      await db
        .selectFrom('app.character_classes')
        .select('name')
        .where('id', '=', 1)
        .executeTakeFirstOrThrow()
    ).name
    expect((await search(className)).total).toBe(2)
    expect((await listAccounts(deps, admin.actor, {})).total).toBe(2)
  })

  it('shows class, registration and the latest application status', async () => {
    const admin = await roleActor('admin')
    const applicant = await roleActor('applicant')
    await applicationRepository.create(db, applicant.user.id, [])
    const { items } = await listAccounts(deps, admin.actor, {
      search: applicant.user.nickname,
    })
    expect(items[0]).toMatchObject({
      applicationStatus: 'pending_officer_review',
      hasActiveApplication: true,
      deletionPending: false,
    })
    expect(items[0]!.className).toBeTruthy()
    expect(items[0]!.registeredAt).toBeTruthy()
  })
})

describe('admin: account card (ADM-03)', () => {
  it('returns all fields and links of the latest application', async () => {
    const admin = await roleActor('admin')
    const target = await roleActor('applicant')
    await db
      .updateTable('app.profiles')
      .set({ city: 'Казань', birth_date: '1990-01-02', about: 'О себе' })
      .where('id', '=', target.user.id)
      .execute()
    await applicationRepository.create(db, target.user.id, [
      'https://example.com/1.png',
      'https://example.com/2.png',
    ])
    const card = await getAccount(deps, admin.actor, {
      userId: target.user.id,
    })
    expect(card).toMatchObject({
      id: target.user.id,
      email: target.user.email,
      classId: 1,
      city: 'Казань',
      birthDate: '1990-01-02',
      about: 'О себе',
      avatarUrl: null,
      equipmentLinks: [
        'https://example.com/1.png',
        'https://example.com/2.png',
      ],
      passwordSet: true,
    })
    await rejects(
      getAccount(deps, admin.actor, {
        userId: '00000000-0000-0000-0000-000000000000',
      }),
      'not_found',
    )
  })
})

describe('admin: edit nickname and class (ADM-16)', () => {
  it('allows admin to change nickname and class for another account', async () => {
    const admin = await roleActor('admin')
    const target = await roleActor('member')

    const result = await setAccountProfile(deps, admin.actor, {
      userId: target.user.id,
      gameNickname: 'Новыйник',
      classId: 2,
    })

    expect(result).toEqual({
      userId: target.user.id,
      gameNickname: 'Новыйник',
      classId: 2,
    })
    await expect(
      db
        .selectFrom('app.profiles')
        .select(['game_nickname', 'class_id'])
        .where('id', '=', target.user.id)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({ game_nickname: 'Новыйник', class_id: 2 })
  })

  it('allows admin to change own and another admin account', async () => {
    const admin = await roleActor('admin')
    const anotherAdmin = await roleActor('admin')

    await setAccountProfile(deps, admin.actor, {
      userId: admin.user.id,
      gameNickname: 'АдминСвой',
      classId: 2,
    })
    await setAccountProfile(deps, admin.actor, {
      userId: anotherAdmin.user.id,
      gameNickname: 'ДругАдм',
      classId: 3,
    })

    const saved = await db
      .selectFrom('app.profiles')
      .select(['game_nickname', 'class_id'])
      .where('id', 'in', [admin.user.id, anotherAdmin.user.id])
      .execute()
    expect(saved).toContainEqual({ game_nickname: 'АдминСвой', class_id: 2 })
    expect(saved).toContainEqual({
      game_nickname: 'ДругАдм',
      class_id: 3,
    })
  })

  it('rejects duplicate nickname and inactive class without changing profile', async () => {
    const admin = await roleActor('admin')
    const target = await roleActor('member')
    const other = await roleActor('member')

    await expect(
      setAccountProfile(deps, admin.actor, {
        userId: target.user.id,
        gameNickname: other.user.nickname,
        classId: 2,
      }),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      fields: { gameNickname: 'nickname_taken' },
    })
    await expect(
      setAccountProfile(deps, admin.actor, {
        userId: target.user.id,
        gameNickname: 'Новый2',
        classId: 9999,
      }),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      fields: { classId: 'required' },
    })

    await expect(
      db
        .selectFrom('app.profiles')
        .select(['game_nickname', 'class_id'])
        .where('id', '=', target.user.id)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({
      game_nickname: target.user.nickname,
      class_id: 1,
    })
  })

  it('rejects profile edits by every role except admin', async () => {
    const target = await roleActor('member')
    const input = {
      userId: target.user.id,
      gameNickname: 'НеАдмин',
      classId: 2,
    }
    for (const [actor, code] of await nonAdmins()) {
      await rejects(setAccountProfile(deps, actor, input), code)
    }
  })

  it('does not update or audit unchanged values', async () => {
    const admin = await roleActor('admin')
    const target = await roleActor('member')

    await setAccountProfile(deps, admin.actor, {
      userId: target.user.id,
      gameNickname: target.user.nickname,
      classId: 1,
    })

    await expect(
      db
        .selectFrom('app.audit_log')
        .select('id')
        .where('action', '=', 'profile_updated')
        .execute(),
    ).resolves.toHaveLength(0)
  })

  it('records only changed field names without values or notification', async () => {
    const admin = await roleActor('admin')
    const target = await roleActor('member')
    const notificationsBefore = await db
      .selectFrom('app.user_notifications')
      .select('id')
      .where('recipient_id', '=', target.user.id)
      .execute()

    await setAccountProfile(deps, admin.actor, {
      userId: target.user.id,
      gameNickname: 'Новенький',
      classId: 2,
    })

    const audit = await db
      .selectFrom('app.audit_log')
      .select(['category', 'action', 'summary', 'details'])
      .where('action', '=', 'profile_updated')
      .executeTakeFirstOrThrow()
    expect(audit).toMatchObject({
      category: 'profiles',
      action: 'profile_updated',
      summary: 'Изменение профиля',
      details: {
        changed_fields: ['game_nickname', 'class_id'],
      },
    })
    expect(JSON.stringify(audit.details)).not.toContain('Новенький')
    expect(JSON.stringify(audit.details)).not.toContain(target.user.nickname)
    await expect(
      db
        .selectFrom('app.user_notifications')
        .select('id')
        .where('recipient_id', '=', target.user.id)
        .execute(),
    ).resolves.toHaveLength(notificationsBefore.length)
  })

  it('rejects edits while account deletion is pending', async () => {
    const admin = await roleActor('admin')
    const target = await roleActor('member')
    await db
      .insertInto('app.user_deletions')
      .values({
        user_id: target.user.id,
        requested_by: admin.user.id,
        nickname: target.user.nickname,
        email: target.user.email,
        stage: 'files',
      })
      .execute()

    await rejects(
      setAccountProfile(deps, admin.actor, {
        userId: target.user.id,
        gameNickname: 'Новыйник',
        classId: 2,
      }),
      'state_conflict',
    )
    const saved = await db
      .selectFrom('app.profiles')
      .select('game_nickname')
      .where('id', '=', target.user.id)
      .executeTakeFirstOrThrow()
    expect(saved.game_nickname).toBe(target.user.nickname)
  })

  it('keeps closed event attendance snapshots unchanged', async () => {
    const admin = await roleActor('admin')
    const target = await roleActor('member')
    const event = await db
      .insertInto('app.events')
      .values({
        title: 'Закрытый архив',
        event_type: 'pve',
        description: 'Исторический снимок',
        starts_at: '2026-11-01T17:00:00Z',
        created_by: target.user.id,
        closed_at: '2026-11-01T19:00:00Z',
        closed_by: admin.user.id,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
    await db
      .insertInto('app.event_activity_records')
      .values({
        event_id: event.id,
        user_id: target.user.id,
        nickname: target.user.nickname,
        class_id: 1,
        status: 'visited',
        group_name: 'Группа 1',
        is_leader: false,
      })
      .execute()

    await setAccountProfile(deps, admin.actor, {
      userId: target.user.id,
      gameNickname: 'Новыйник',
      classId: 2,
    })

    const snapshot = await db
      .selectFrom('app.event_activity_records')
      .select(['nickname', 'class_id'])
      .where('event_id', '=', event.id)
      .where('user_id', '=', target.user.id)
      .executeTakeFirstOrThrow()
    expect(snapshot).toEqual({ nickname: target.user.nickname, class_id: 1 })
  })
})

describe('admin: password of another account (ADM-07, Q-72)', () => {
  it('changes the password, ends sessions and audits without the password', async () => {
    const admin = await roleActor('admin')
    const target = await roleActor('member')
    const oldToken = await signIn(target.user.email)
    const verify = createTokenVerifier(env('API_URL'), env('ANON_KEY'))
    expect(await verify(oldToken)).toBe(target.user.id)

    await setPassword(deps, admin.actor, {
      userId: target.user.id,
      password: 'brand-new-pass',
    })

    expect(await verify(oldToken)).toBeNull()
    await expect(signIn(target.user.email, TEST_PASSWORD)).rejects.toThrow(
      /Invalid login credentials/,
    )
    expect(await signIn(target.user.email, 'brand-new-pass')).toBeTruthy()
    const audit = await db
      .selectFrom('app.audit_log')
      .select(['action', 'target_nickname', 'details'])
      .where('action', '=', 'password_changed')
      .executeTakeFirstOrThrow()
    expect(audit.target_nickname).toBe(target.user.nickname)
    expect(JSON.stringify(audit)).not.toContain('brand-new-pass')
  })

  it('rejects self, the primary admin and a short password', async () => {
    const admin = await roleActor('admin')
    const primary = await createProfiledUser(db, 'admin')
    await db
      .updateTable('app.profiles')
      .set({ is_primary_admin: true })
      .where('id', '=', primary.id)
      .execute()
    const member = await roleActor('member')
    await rejects(
      setPassword(deps, admin.actor, {
        userId: admin.user.id,
        password: 'brand-new-pass',
      }),
      'forbidden',
    )
    await rejects(
      setPassword(deps, admin.actor, {
        userId: primary.id,
        password: 'brand-new-pass',
      }),
      'primary_admin',
    )
    await expect(
      setPassword(deps, admin.actor, {
        userId: member.user.id,
        password: 'short',
      }),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      fields: { password: 'password_short' },
    })
    expect(
      await db
        .selectFrom('app.audit_log')
        .select('id')
        .where('action', '=', 'password_changed')
        .execute(),
    ).toHaveLength(0)
  })
})

describe('admin: audit log (ADM-10, ADM-12, Q-68)', () => {
  it('pages from newest, filters by category and searches actor and action', async () => {
    const admin = await roleActor('admin')
    const officer = await roleActor('officer')
    for (let i = 0; i < 3; i += 1) {
      await saveDraft(deps, officer.actor, {
        body: `Текст ${i}`,
        channels: ['vk'],
      })
    }
    await sql`insert into app.audit_log (category, action, summary)
      values ('events', 'event_created', 'Создание события')`.execute(db)

    const first = await listAudit(deps, admin.actor, { limit: 2 })
    expect(first.items.map((item) => item.action)).toEqual([
      'event_created',
      'broadcast_draft_saved',
    ])
    const second = await listAudit(deps, admin.actor, {
      limit: 2,
      cursor: first.nextCursor,
    })
    expect(second.items).toHaveLength(2)
    expect(second.nextCursor).toBeNull()
    const ids = [...first.items, ...second.items].map((item) => item.id)
    expect(new Set(ids).size).toBe(4)

    const broadcast = await listAudit(deps, admin.actor, {
      category: 'broadcast',
    })
    expect(broadcast.items).toHaveLength(3)
    expect(broadcast.items[0]!.actor).toEqual({
      nickname: officer.user.nickname,
      role: 'officer',
      email: officer.user.email,
    })
    const byActor = await listAudit(deps, admin.actor, {
      search: officer.user.nickname,
    })
    expect(byActor.items).toHaveLength(3)
    const byAction = await listAudit(deps, admin.actor, { search: 'событ' })
    expect(byAction.items.map((item) => item.action)).toEqual(['event_created'])
  })
})
