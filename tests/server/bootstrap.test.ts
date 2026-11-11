import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { bootstrapFirstAdmin } from '../../supabase/functions/_shared/account/service.ts'
import { moscowDate } from '../../supabase/functions/_shared/membership.ts'
import {
  createAuthUser,
  createProfiledUser,
  resetAppData,
  testDb,
} from './support.ts'

const db = testDb()
const input = (email: string) => ({
  email,
  gameNickname: 'Владелец',
  displayName: 'Павел',
  classSlug: 'mage',
})

beforeEach(() => resetAppData(db))
afterAll(() => db.destroy())

describe('first administrator bootstrap', () => {
  it('creates the primary admin without an application and audits it', async () => {
    const user = await createAuthUser()
    const now = new Date('2026-11-08T22:30:00Z')
    await bootstrapFirstAdmin(db, input(user.email.toUpperCase()), now)
    const profile = await db
      .selectFrom('app.profiles')
      .selectAll()
      .where('id', '=', user.id)
      .executeTakeFirstOrThrow()
    expect(profile).toMatchObject({
      access_role: 'admin',
      is_primary_admin: true,
      joined_on: '2026-11-09',
    })
    const applications = await db
      .selectFrom('app.join_applications')
      .selectAll()
      .execute()
    expect(applications).toHaveLength(0)
    const audit = await db.selectFrom('app.audit_log').selectAll().execute()
    expect(audit).toMatchObject([
      { action: 'first_admin_bootstrapped', actor_id: user.id },
    ])
  })

  it('refuses a second run once an admin exists', async () => {
    await createProfiledUser(db, 'admin')
    const user = await createAuthUser()
    await expect(
      bootstrapFirstAdmin(db, input(user.email)),
    ).rejects.toMatchObject({
      code: 'already_bootstrapped',
    })
  })

  it('refuses an unconfirmed email', async () => {
    const user = await createAuthUser({ confirmed: false })
    await expect(
      bootstrapFirstAdmin(db, input(user.email)),
    ).rejects.toMatchObject({
      code: 'email_not_confirmed',
    })
  })

  it('refuses a user who already has a profile', async () => {
    const user = await createProfiledUser(db, 'applicant')
    await expect(
      bootstrapFirstAdmin(db, input(user.email)),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      fields: { email: 'profile_exists' },
    })
  })

  it('uses the Moscow calendar date', () => {
    expect(moscowDate(new Date('2026-11-08T20:59:59Z'))).toBe('2026-11-08')
    expect(moscowDate(new Date('2026-11-08T21:00:00Z'))).toBe('2026-11-09')
  })
})
