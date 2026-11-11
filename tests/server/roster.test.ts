import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  GUEST,
  type Actor,
} from '../../supabase/functions/_shared/auth/actor.ts'
import type { AccessRole } from '../../supabase/functions/_shared/contracts/account.ts'
import {
  countRoster,
  listReaders,
  listRoster,
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
  'classId',
  'className',
  'gameNickname',
  'id',
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
      'admin',
    ] as const) {
      await createProfiledUser(db, role)
    }
    expect(await countRoster(deps)).toEqual({ count: 4 })
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
    await setProfile(zed.id, {
      game_nickname: 'zed',
      city: 'Казань',
      birth_date: '1990-01-02',
      about: 'Рассказ',
    })
    await setProfile(amy.id, { game_nickname: 'amy' })
    await createProfiledUser(db, 'applicant')
    await createProfiledUser(db, 'reader')
    const { user: admin, actor } = await roleActor('admin')
    await setProfile(admin.id, { game_nickname: 'mid' })

    const roster = await listRoster(deps, actor)
    expect(roster.members.map((member) => member.gameNickname)).toEqual([
      'amy',
      'mid',
      'zed',
    ])
    expect(roster.total).toBe(3)
    for (const member of roster.members) {
      expect(Object.keys(member).sort()).toEqual(CARD_KEYS)
    }
    expect(roster.members.map((member) => member.role)).toEqual([
      'officer',
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

    const { classes } = await listRoster(deps, actor)
    expect(classes).toHaveLength(active.length)
    const counts = Object.fromEntries(classes.map((c) => [c.classId, c.count]))
    expect(counts[1]).toBe(1)
    expect(counts[2]).toBe(1)
    expect(classes.reduce((sum, c) => sum + c.count, 0)).toBe(2)
  })

  it('signs avatar links for roster cards', async () => {
    const { user, actor } = await roleActor('member')
    const path = await uploadAvatar(deps, user.id)
    await setProfile(user.id, { avatar_path: path })
    const [card] = (await listRoster(deps, actor)).members
    expect(card?.avatarUrl).toContain('/storage/v1/object/sign/avatars/')
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
      await rejects(listReaders(deps, actor), 'forbidden')
    }
    for (const role of ['officer', 'admin'] as const) {
      const { readers } = await listReaders(deps, (await roleActor(role)).actor)
      // Два чтеца: созданный выше и тот, кто проверял отказ.
      expect(readers.map((r) => r.role)).toEqual(['reader', 'reader'])
      expect(readers.map((r) => r.id)).toContain(reader.id)
      for (const card of readers) {
        expect(Object.keys(card).sort()).toEqual(CARD_KEYS)
      }
    }
  })
})
