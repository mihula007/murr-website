import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  GUEST,
  type Actor,
} from '../../supabase/functions/_shared/auth/actor.ts'
import { createRoutes } from '../../supabase/functions/_shared/app.ts'
import type { AccessRole } from '../../supabase/functions/_shared/contracts/account.ts'
import {
  countRoster,
  listReaders,
  listRosterPage,
  listRoster,
  rosterStats,
} from '../../supabase/functions/_shared/roster/service.ts'
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

async function setProfile(id: string, values: Record<string, unknown>) {
  await db
    .updateTable('app.profiles')
    .set(values)
    .where('id', '=', id)
    .execute()
}

const CARD_KEYS = [
  'avatarUrl',
  'bd',
  'bu',
  'classId',
  'className',
  'gameNickname',
  'id',
  'hp',
  'pa',
  'pz',
  'role',
].sort()

describe('roster/count', () => {
  it('counts only members, officers and admins for anyone (ROS-01)', async () => {
    for (const role of [
      'applicant',
      'reader',
      'member',
      'member',
      'officer',
      'master',
      'admin',
    ] as const) {
      await createProfiledUser(db, role)
    }
    expect(await countRoster(deps)).toEqual({ count: 5 })
  })
})

describe('roster/list', () => {
  it('rejects a guest, a user without a profile, applicants and readers (ACL-09)', async () => {
    await rejects(listRoster(deps, GUEST), 'not_authenticated')
    const incomplete = await actorOf(db, (await createAuthUser()).id)
    await rejects(listRoster(deps, incomplete), 'registration_incomplete')
    for (const role of ['applicant', 'reader'] as const) {
      await rejects(
        listRoster(deps, (await roleActor(role)).actor),
        'forbidden',
      )
    }
  })

  it('lists the current roster by nickname without closed fields (ROS-01–03)', async () => {
    const zed = await createProfiledUser(db, 'member')
    const amy = await createProfiledUser(db, 'officer')
    const master = await createProfiledUser(db, 'master')
    await setProfile(zed.id, {
      game_nickname: 'zed',
      city: 'Казань',
      birth_date: '1990-01-02',
      about: 'Рассказ',
    })
    await setProfile(amy.id, { game_nickname: 'amy' })
    await setProfile(master.id, { game_nickname: 'beta' })
    await createProfiledUser(db, 'applicant')
    await createProfiledUser(db, 'reader')
    const { user: admin, actor } = await roleActor('admin')
    await setProfile(admin.id, { game_nickname: 'mid' })

    const roster = await listRoster(deps, actor)
    expect(roster.items.map((member) => member.gameNickname)).toEqual([
      'amy',
      'beta',
      'mid',
      'zed',
    ])
    expect(roster.truncated).toBe(false)
    expect((await rosterStats(deps, actor)).total).toBe(4)
    for (const member of roster.items) {
      expect(Object.keys(member).sort()).toEqual(CARD_KEYS)
      expect(member).not.toHaveProperty('characterStatsSource')
    }
    expect(roster.items.map((member) => member.role)).toEqual([
      'officer',
      'master',
      'admin',
      'member',
    ])
  })

  it('returns stats for every active class, including empty ones', async () => {
    const { actor } = await roleActor('member')
    const other = await createProfiledUser(db, 'officer')
    await setProfile(other.id, { class_id: 2 })
    await createProfiledUser(db, 'reader')
    const active = await db
      .selectFrom('app.character_classes')
      .select('id')
      .where('is_active', '=', true)
      .execute()

    const { classes } = await rosterStats(deps, actor)
    expect(classes).toHaveLength(active.length)
    const counts = Object.fromEntries(classes.map((c) => [c.classId, c.count]))
    expect(counts[1]).toBe(1)
    expect(counts[2]).toBe(1)
    expect(classes.reduce((sum, c) => sum + c.count, 0)).toBe(2)
  })

  it('returns the whole roster in one response past 50 members (Q-48)', async () => {
    const { user: admin, actor } = await roleActor('admin')
    await setProfile(admin.id, { game_nickname: 'a00' })
    for (let index = 0; index < 55; index++) {
      const user = await createProfiledUser(db, 'member')
      await setProfile(user.id, {
        game_nickname: `m${String(index).padStart(2, '0')}`,
      })
    }
    // Чтец в состав не попадает.
    await createProfiledUser(db, 'reader')

    const roster = await listRoster(deps, actor)
    expect(roster.items).toHaveLength(56)
    expect(roster.truncated).toBe(false)
    expect(roster.items[0]?.gameNickname).toBe('a00')
    expect(roster.items.at(-1)?.gameNickname).toBe('m54')
    expect((await rosterStats(deps, actor)).total).toBe(56)
  })

  it('signs avatar links for roster cards', async () => {
    const { user, actor } = await roleActor('member')
    const path = await uploadAvatar(deps, user.id)
    await setProfile(user.id, { avatar_path: path })
    const [card] = (await listRoster(deps, actor)).items
    expect(card?.avatarUrl).toContain('/storage/v1/object/sign/avatars/')
  })
})

describe('roster/page', () => {
  it('registers the paged operation in the shared API dispatcher', () => {
    expect(createRoutes(deps)['roster/page']).toEqual(expect.any(Function))
  })

  it('rejects guests, applicants, readers, and incomplete accounts', async () => {
    await rejects(listRosterPage(deps, GUEST, {}), 'not_authenticated')
    const incomplete = await actorOf(db, (await createAuthUser()).id)
    await rejects(
      listRosterPage(deps, incomplete, {}),
      'registration_incomplete',
    )
    for (const role of ['applicant', 'reader'] as const) {
      await rejects(
        listRosterPage(deps, (await roleActor(role)).actor, {}),
        'forbidden',
      )
    }
  })

  it('continues beyond the legacy 250-member cap in stable 24-item pages', async () => {
    const { user: first, actor } = await roleActor('member')
    await setProfile(first.id, { game_nickname: 'a00', city: 'Казань' })
    const users: Awaited<ReturnType<typeof createProfiledUser>>[] = []
    for (let start = 0; start < 250; start += 25) {
      users.push(
        ...(await Promise.all(
          Array.from({ length: 25 }, () => createProfiledUser(db, 'member')),
        )),
      )
    }
    await Promise.all(
      users.map((user, index) =>
        setProfile(user.id, {
          game_nickname: `m${String(index).padStart(3, '0')}`,
          city: 'Казань',
        }),
      ),
    )

    const all: Awaited<ReturnType<typeof listRosterPage>>['items'] = []
    const pageSizes: number[] = []
    let cursor: string | null = null
    do {
      const page = await listRosterPage(deps, actor, { cursor })
      all.push(...page.items)
      pageSizes.push(page.items.length)
      cursor = page.nextCursor
    } while (cursor !== null)

    expect(pageSizes).toEqual([...Array<number>(10).fill(24), 11])
    expect(all).toHaveLength(251)
    expect(all.map((item) => item.gameNickname)).toEqual([
      ...[...all.map((item) => item.gameNickname)].sort(),
    ])
    expect(all[0]?.gameNickname).toBe('a00')
    expect(new Set(all.map((item) => item.id)).size).toBe(251)
    for (const item of all) {
      expect(Object.keys(item).sort()).toEqual(CARD_KEYS)
      expect(item).not.toHaveProperty('city')
    }
  }, 120_000)

  it('searches nick and class case-insensitively and combines class filtering', async () => {
    const { actor } = await roleActor('member')
    const mystic = await createProfiledUser(db, 'member')
    const other = await createProfiledUser(db, 'member')
    const wildcard = await createProfiledUser(db, 'member')
    await setProfile(mystic.id, { game_nickname: 'Mystic1', class_id: 13 })
    await setProfile(other.id, { game_nickname: 'Other1', class_id: 1 })
    await setProfile(wildcard.id, { game_nickname: 'A%1', class_id: 1 })

    const byNickname = await listRosterPage(deps, actor, { search: 'mYsTiC' })
    expect(byNickname.items.map((item) => item.id)).toEqual([mystic.id])

    const byClass = await listRosterPage(deps, actor, {
      classId: 13,
      search: 'МИСТ',
    })
    expect(byClass.items.map((item) => item.id)).toEqual([mystic.id])

    const literalPercent = await listRosterPage(deps, actor, { search: '%' })
    expect(literalPercent.items.map((item) => item.id)).toEqual([wildcard.id])
  })

  it('filters by multiple classes and intersects them with the search', async () => {
    const { actor, user } = await roleActor('member')
    await setProfile(user.id, { class_id: 17 })
    const wolf = await createProfiledUser(db, 'member')
    const mage = await createProfiledUser(db, 'member')
    const warrior = await createProfiledUser(db, 'member')
    await setProfile(wolf.id, { game_nickname: 'Wolf1', class_id: 1 })
    await setProfile(mage.id, { game_nickname: 'Mage1', class_id: 7 })
    await setProfile(warrior.id, { game_nickname: 'Warrior1', class_id: 8 })

    const selected = await listRosterPage(deps, actor, { classIds: [1, 7] })
    expect(selected.items.map((item) => item.id).sort()).toEqual(
      [wolf.id, mage.id].sort(),
    )

    const searched = await listRosterPage(deps, actor, {
      classIds: [1, 7],
      search: 'mage',
    })
    expect(searched.items.map((item) => item.id)).toEqual([mage.id])

    const all = await listRosterPage(deps, actor, { classIds: [] })
    expect(all.items.map((item) => item.id)).toEqual(
      expect.arrayContaining([wolf.id, mage.id, warrior.id]),
    )
  })

  it('rejects invalid cursors, classes, and search strings longer than 100 characters', async () => {
    const { actor } = await roleActor('member')
    await rejects(
      listRosterPage(deps, actor, { cursor: 'broken' }),
      'validation_failed',
    )
    await rejects(
      listRosterPage(deps, actor, { classId: 0 }),
      'validation_failed',
    )
    await rejects(
      listRosterPage(deps, actor, { search: 'x'.repeat(101) }),
      'validation_failed',
    )
  })
})

describe('roster/readers', () => {
  it('is available only to officers and admins', async () => {
    const reader = await createProfiledUser(db, 'reader')
    await createProfiledUser(db, 'member')
    const denied: Actor[] = [
      (await roleActor('applicant')).actor,
      (await roleActor('reader')).actor,
      (await roleActor('member')).actor,
    ]
    for (const actor of denied) {
      await rejects(listReaders(deps, actor, {}), 'forbidden')
    }
    for (const role of ['officer', 'master', 'admin'] as const) {
      const { items: readers } = await listReaders(
        deps,
        (await roleActor(role)).actor,
        {},
      )
      // Два чтеца: созданный выше и тот, кто проверял отказ.
      expect(readers.map((r) => r.role)).toEqual(['reader', 'reader'])
      expect(readers.map((r) => r.id)).toContain(reader.id)
      for (const card of readers) {
        expect(Object.keys(card).sort()).toEqual(CARD_KEYS)
      }
    }
  })
})
