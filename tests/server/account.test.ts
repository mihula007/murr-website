import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  checkNickname,
  completeRegistration,
  createAvatarUpload,
  getMe,
  updateProfile,
} from '../../supabase/functions/_shared/account/service.ts'
import {
  GUEST,
  type Actor,
} from '../../supabase/functions/_shared/auth/actor.ts'
import type { AccessRole } from '../../supabase/functions/_shared/contracts/account.ts'
import {
  actorOf,
  createAuthUser,
  createProfiledUser,
  registration,
  resetAppData,
  testDb,
  testDeps,
  uploadAvatar,
} from './support.ts'

const db = testDb()
const deps = testDeps(db)
const ROLES: AccessRole[] = [
  'applicant',
  'reader',
  'member',
  'officer',
  'admin',
]

beforeEach(() => resetAppData(db))
afterAll(() => db.destroy())

async function unconfirmedActor() {
  return actorOf(db, (await createAuthUser({ confirmed: false })).id)
}
async function incompleteActor() {
  const user = await createAuthUser()
  return { user, actor: await actorOf(db, user.id) }
}
async function roleActor(role: AccessRole) {
  const user = await createProfiledUser(db, role)
  return { user, actor: await actorOf(db, user.id) }
}
const profileUpdate = (overrides: Record<string, unknown> = {}) => ({
  displayName: 'Новое',
  gameNickname: 'Новый',
  city: '',
  birthDate: null,
  classId: 2,
  about: null,
  avatar: { action: 'keep' },
  ...overrides,
})
async function auditRows() {
  return db.selectFrom('app.audit_log').selectAll().orderBy('id').execute()
}
const rejects = (promise: Promise<unknown>, code: string) =>
  expect(promise).rejects.toMatchObject({ code })

describe('access matrix', () => {
  it('rejects a guest everywhere except public operations', async () => {
    await rejects(getMe(deps, GUEST), 'not_authenticated')
    await rejects(
      createAvatarUpload(deps, GUEST, { contentType: 'image/png' }),
      'not_authenticated',
    )
    await rejects(
      completeRegistration(deps, GUEST, registration()),
      'not_authenticated',
    )
    await rejects(
      updateProfile(deps, GUEST, profileUpdate()),
      'not_authenticated',
    )
    expect(await checkNickname(deps, { gameNickname: 'Свободен' })).toEqual({
      available: true,
    })
  })

  it('rejects a user with an unconfirmed email', async () => {
    const actor = await unconfirmedActor()
    await rejects(getMe(deps, actor), 'email_not_confirmed')
    await rejects(
      createAvatarUpload(deps, actor, { contentType: 'image/png' }),
      'email_not_confirmed',
    )
    await rejects(
      completeRegistration(deps, actor, registration()),
      'email_not_confirmed',
    )
    await rejects(
      updateProfile(deps, actor, profileUpdate()),
      'email_not_confirmed',
    )
  })

  it('lets a confirmed user without a profile only finish registration', async () => {
    const { actor } = await incompleteActor()
    expect(await getMe(deps, actor)).toMatchObject({ state: 'incomplete' })
    await expect(
      createAvatarUpload(deps, actor, { contentType: 'image/webp' }),
    ).resolves.toMatchObject({ bucket: 'avatars' })
    await rejects(
      updateProfile(deps, actor, profileUpdate()),
      'registration_incomplete',
    )
  })

  it.each(ROLES)(
    'lets %s read and edit only their own profile',
    async (role) => {
      const { user, actor } = await roleActor(role)
      const me = await getMe(deps, actor)
      expect(me).toMatchObject({
        state: 'ready',
        profile: { id: user.id, role },
      })
      const updated = await updateProfile(deps, actor, {
        ...profileUpdate({ gameNickname: `x${role.slice(0, 6)}` }),
        access_role: 'admin',
        joined_on: '2020-01-01',
      })
      expect(updated).toMatchObject({
        state: 'ready',
        profile: { role, joinedOn: null },
      })
    },
  )

  it.each(ROLES)(
    'does not create a second application for %s',
    async (role) => {
      const { user, actor } = await roleActor(role)
      const me = await completeRegistration(deps, actor, registration())
      expect(me).toMatchObject({ state: 'ready', profile: { role } })
      const count = await db
        .selectFrom('app.join_applications')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('applicant_id', '=', user.id)
        .executeTakeFirstOrThrow()
      expect(Number(count.n)).toBe(0)
      expect(await auditRows()).toHaveLength(0)
    },
  )

  it('hides the application status from a reader', async () => {
    const { actor } = await roleActor('reader')
    expect(await getMe(deps, actor)).toMatchObject({ application: null })
  })
})

describe('complete registration', () => {
  async function register(actor: Actor, userId: string, overrides = {}) {
    const avatarPath = await uploadAvatar(deps, userId)
    return completeRegistration(deps, actor, {
      ...registration(overrides),
      avatarPath,
    })
  }

  it('creates an applicant, one application, links and one audit event', async () => {
    const { user, actor } = await incompleteActor()
    const me = await register(actor, user.id)
    expect(me).toMatchObject({
      state: 'ready',
      profile: {
        role: 'applicant',
        avatarUrl: expect.stringContaining('http'),
      },
      application: { status: 'pending_officer_review' },
    })
    const links = await db
      .selectFrom('app.application_equipment_links')
      .selectAll()
      .execute()
    expect(links).toHaveLength(1)
    const audit = await auditRows()
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({
      category: 'applications',
      action: 'registration_completed',
      actor_id: user.id,
      actor_email: user.email,
      target_kind: 'join_application',
    })
    expect(JSON.stringify(audit[0]?.details)).not.toContain('Москва')
  })

  it('is idempotent across parallel calls (two tabs)', async () => {
    const { user, actor } = await incompleteActor()
    const avatarPath = await uploadAvatar(deps, user.id)
    const body = { ...registration(), avatarPath }
    const results = await Promise.all([
      completeRegistration(deps, actor, body),
      completeRegistration(deps, actor, body),
    ])
    expect(results.map((r) => r.state)).toEqual(['ready', 'ready'])
    const applications = await db
      .selectFrom('app.join_applications')
      .selectAll()
      .execute()
    expect(applications).toHaveLength(1)
    expect(await auditRows()).toHaveLength(1)
  })

  it('rejects a taken nickname with a field error, case-sensitively', async () => {
    const first = await incompleteActor()
    await register(first.actor, first.user.id, { gameNickname: 'Рейна' })
    const second = await incompleteActor()
    await expect(
      register(second.actor, second.user.id, { gameNickname: 'Рейна' }),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      fields: { gameNickname: 'nickname_taken' },
    })
    await expect(
      register(second.actor, second.user.id, { gameNickname: 'рейна' }),
    ).resolves.toMatchObject({ state: 'ready' })
  })

  it('validates required fields and limits', async () => {
    const { user, actor } = await incompleteActor()
    const avatarPath = await uploadAvatar(deps, user.id)
    await expect(
      completeRegistration(deps, actor, {
        ...registration({
          displayName: 'Тринадцать133',
          gameNickname: 'Десятьсимв',
          city: ' ',
        }),
        avatarPath,
      }),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      fields: {
        displayName: 'too_long',
        gameNickname: 'too_long',
        city: 'required',
      },
    })
  })

  it('rejects an avatar that is not an image or not in the user folder', async () => {
    const { user, actor } = await incompleteActor()
    const fake = await uploadAvatar(
      deps,
      user.id,
      new TextEncoder().encode('not an image'),
    )
    await rejects(
      completeRegistration(deps, actor, {
        ...registration(),
        avatarPath: fake,
      }),
      'avatar_invalid',
    )
    const other = await createAuthUser()
    const foreign = await uploadAvatar(deps, other.id)
    await rejects(
      completeRegistration(deps, actor, {
        ...registration(),
        avatarPath: foreign,
      }),
      'avatar_invalid',
    )
  })

  it('removes earlier uploads from the user folder after success', async () => {
    const { user, actor } = await incompleteActor()
    await uploadAvatar(deps, user.id)
    await register(actor, user.id)
    expect(await deps.storage.list('avatars', user.id)).toHaveLength(1)
  })
})

describe('update profile', () => {
  it('frees the previous nickname for others', async () => {
    const first = await roleActor('member')
    await updateProfile(
      deps,
      first.actor,
      profileUpdate({ gameNickname: 'Новыйник' }),
    )
    expect(
      await checkNickname(deps, { gameNickname: first.user.nickname }),
    ).toEqual({
      available: true,
    })
    const second = await roleActor('member')
    await expect(
      updateProfile(
        deps,
        second.actor,
        profileUpdate({ gameNickname: first.user.nickname }),
      ),
    ).resolves.toMatchObject({ profile: { gameNickname: first.user.nickname } })
    await expect(
      updateProfile(
        deps,
        second.actor,
        profileUpdate({ gameNickname: 'Новыйник' }),
      ),
    ).rejects.toMatchObject({ fields: { gameNickname: 'nickname_taken' } })
  })

  it('audits only the names of changed fields', async () => {
    const { actor } = await roleActor('member')
    await updateProfile(deps, actor, profileUpdate({ city: 'Казань' }))
    const [row] = await auditRows()
    expect(row).toMatchObject({
      category: 'profiles',
      action: 'profile_updated',
    })
    expect(row?.details).toEqual({
      changed_fields: ['display_name', 'game_nickname', 'city', 'class_id'],
    })
    expect(JSON.stringify(row)).not.toContain('Казань')
  })

  it('writes nothing when nothing changed', async () => {
    const { actor } = await roleActor('member')
    const current = await getMe(deps, actor)
    if (current.state !== 'ready') throw new Error('нет профиля')
    await updateProfile(deps, await actorOf(db, current.profile.id), {
      displayName: current.profile.displayName,
      gameNickname: current.profile.gameNickname,
      city: null,
      birthDate: null,
      classId: current.profile.classId,
      about: null,
      avatar: { action: 'keep' },
    })
    expect(await auditRows()).toHaveLength(0)
  })

  it('replaces and removes the avatar', async () => {
    const { user, actor } = await roleActor('reader')
    const path = await uploadAvatar(deps, user.id)
    const replaced = await updateProfile(
      deps,
      actor,
      profileUpdate({ avatar: { action: 'replace', path } }),
    )
    expect(replaced).toMatchObject({
      profile: { avatarUrl: expect.stringContaining('http') },
    })
    const removed = await updateProfile(
      deps,
      await actorOf(db, user.id),
      profileUpdate({ avatar: { action: 'remove' } }),
    )
    expect(removed).toMatchObject({ profile: { avatarUrl: null } })
    expect(await deps.storage.list('avatars', user.id)).toHaveLength(0)
  })
})
