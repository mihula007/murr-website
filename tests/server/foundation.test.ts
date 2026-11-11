import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  GUEST,
  loadActor,
} from '../../supabase/functions/_shared/auth/actor.ts'
import { createTokenVerifier } from '../../supabase/functions/_shared/auth/token.ts'
import {
  AUDIT_LIMIT,
  auditRepository,
} from '../../supabase/functions/_shared/audit/repository.ts'
import { writeAudit } from '../../supabase/functions/_shared/audit/service.ts'
import { avatarUrls } from '../../supabase/functions/_shared/account/avatars.ts'
import type { AccessRole } from '../../supabase/functions/_shared/contracts/account.ts'
import { withTransaction } from '../../supabase/functions/_shared/db/client.ts'
import {
  INTERNAL_ROLES,
  joinedOnAfterRoleChange,
} from '../../supabase/functions/_shared/membership.ts'
import { notificationRepository } from '../../supabase/functions/_shared/notifications/repository.ts'
import {
  notify,
  type Notification,
} from '../../supabase/functions/_shared/notifications/service.ts'
import {
  createAuthUser,
  createProfiledUser,
  env,
  resetAppData,
  signIn,
  testDb,
  testDeps,
  uploadAvatar,
} from './support.ts'

const db = testDb()

const event = (n: number) => ({
  category: 'profiles' as const,
  action: 'test_event',
  summary: `Событие ${n}`,
  actor: null,
})

/** Быстрое наполнение журнала в обход сервиса — только подготовка данных. */
async function seedAudit(count: number) {
  await db
    .insertInto('app.audit_log')
    .values(
      Array.from({ length: count }, (_, n) => ({
        category: 'profiles',
        action: 'seed',
        summary: `Событие ${n + 1}`,
      })),
    )
    .execute()
}

beforeEach(() => resetAppData(db))
afterAll(() => db.destroy())

describe('transactions', () => {
  it('rolls back the audit record together with a failed operation', async () => {
    await expect(
      withTransaction(db, async (tx) => {
        await writeAudit(tx, event(1))
        throw new Error('сбой операции')
      }),
    ).rejects.toThrow('сбой операции')
    expect(await auditRepository.count(db)).toBe(0)
  })
})

describe('audit log', () => {
  it(`keeps only the latest ${AUDIT_LIMIT} records`, async () => {
    await seedAudit(AUDIT_LIMIT - 2)
    await withTransaction(db, async (tx) => {
      for (let n = AUDIT_LIMIT - 1; n <= AUDIT_LIMIT + 5; n += 1) {
        await writeAudit(tx, event(n))
      }
    })
    expect(await auditRepository.count(db)).toBe(AUDIT_LIMIT)
    const oldest = await db
      .selectFrom('app.audit_log')
      .select('summary')
      .orderBy('id')
      .limit(1)
      .executeTakeFirstOrThrow()
    expect(oldest.summary).toBe('Событие 6')
  })

  it('stays within the limit under concurrent transactions', async () => {
    await seedAudit(AUDIT_LIMIT - 5)
    await Promise.all(
      Array.from({ length: 20 }, (_, n) =>
        withTransaction(db, (tx) => writeAudit(tx, event(5000 + n))),
      ),
    )
    expect(await auditRepository.count(db)).toBe(AUDIT_LIMIT)
  })

  it('accepts the stage 4 details keys', async () => {
    await withTransaction(db, (tx) =>
      writeAudit(tx, {
        ...event(1),
        details: {
          previous_role: 'member',
          role: 'reader',
          decision: 'accept',
          user_id: crypto.randomUUID(),
        },
      }),
    )
    expect(await auditRepository.count(db)).toBe(1)
  })

  it('rejects details keys outside the allowlist', async () => {
    await expect(
      withTransaction(db, (tx) =>
        writeAudit(tx, { ...event(1), details: { password: 'x' } }),
      ),
    ).rejects.toThrow('не разрешён')
  })
})

describe('actor', () => {
  it('is a guest for an unknown user id', async () => {
    expect(await loadActor(db, crypto.randomUUID())).toEqual(GUEST)
  })

  it('reports an unconfirmed email and a missing profile', async () => {
    const user = await createAuthUser({ confirmed: false })
    expect(await loadActor(db, user.id)).toMatchObject({
      kind: 'user',
      emailConfirmed: false,
      profile: null,
    })
  })

  it('loads the role from the profile', async () => {
    const user = await createProfiledUser(db, 'officer')
    const actor = await loadActor(db, user.id)
    expect(actor.kind === 'user' && actor.profile?.access_role).toBe('officer')
  })
})

describe('token verifier', () => {
  const verify = () => createTokenVerifier(env('API_URL'), env('ANON_KEY'))

  it('returns the user id for a valid session token', async () => {
    const user = await createAuthUser()
    expect(await verify()(await signIn(user.email))).toBe(user.id)
  })

  it('treats a project key or garbage as no session', async () => {
    expect(await verify()(env('ANON_KEY').slice(0, 20))).toBeNull()
    expect(await verify()('a.b.c')).toBeNull()
  })
})

describe('membership rules', () => {
  const ROLES: AccessRole[] = [
    'applicant',
    'reader',
    'member',
    'officer',
    'admin',
  ]
  const internal = (role: AccessRole) =>
    (INTERNAL_ROLES as readonly AccessRole[]).includes(role)

  it('sets the join date only when entering an internal role', () => {
    for (const previous of ROLES) {
      for (const next of ROLES) {
        const result = joinedOnAfterRoleChange(
          previous,
          next,
          '2026-01-01',
          '2026-11-11',
        )
        const expected =
          !internal(previous) && internal(next) ? '2026-11-11' : '2026-01-01'
        expect(result, `${previous} → ${next}`).toBe(expected)
      }
    }
  })

  it('keeps a missing join date when no internal role is entered', () => {
    expect(joinedOnAfterRoleChange('applicant', 'reader', null, 'x')).toBeNull()
    expect(
      joinedOnAfterRoleChange('reader', 'member', null, '2026-11-11'),
    ).toBe('2026-11-11')
  })
})

describe('notifications', () => {
  async function setup() {
    const recipient = await createProfiledUser(db, 'applicant')
    const officer = await createProfiledUser(db, 'officer')
    const source = { kind: 'join_application', id: crypto.randomUUID() }
    const notification: Notification = {
      recipientId: recipient.id,
      actorId: officer.id,
      kind: 'application_accepted',
      title: 'Заявка принята',
      target: source,
      source,
    }
    return { recipient, officer, notification }
  }

  it('creates a notification for the recipient', async () => {
    const { recipient, notification } = await setup()
    const id = await withTransaction(db, (tx) => notify(tx, notification))
    expect(id).toEqual(expect.any(String))
    const rows = await notificationRepository.listForRecipient(db, recipient.id)
    expect(rows).toMatchObject([
      { kind: 'application_accepted', title: 'Заявка принята', read_at: null },
    ])
  })

  it('does not duplicate a repeated notification from the same source', async () => {
    const { recipient, notification } = await setup()
    await withTransaction(db, (tx) => notify(tx, notification))
    const repeat = await withTransaction(db, (tx) => notify(tx, notification))
    expect(repeat).toBeNull()
    const rows = await notificationRepository.listForRecipient(db, recipient.id)
    expect(rows).toHaveLength(1)
  })

  it('does not notify the initiator about their own action', async () => {
    const { recipient, notification } = await setup()
    const id = await withTransaction(db, (tx) =>
      notify(tx, { ...notification, actorId: recipient.id }),
    )
    expect(id).toBeNull()
    expect(
      await notificationRepository.listForRecipient(db, recipient.id),
    ).toHaveLength(0)
  })

  it('is rolled back together with a failed operation', async () => {
    const { recipient, notification } = await setup()
    await expect(
      withTransaction(db, async (tx) => {
        await notify(tx, notification)
        throw new Error('сбой операции')
      }),
    ).rejects.toThrow('сбой операции')
    expect(
      await notificationRepository.listForRecipient(db, recipient.id),
    ).toHaveLength(0)
  })
})

describe('batch signed avatar urls', () => {
  const deps = testDeps(db)

  it('signs existing paths in one call and skips missing ones', async () => {
    const user = await createAuthUser()
    const path = await uploadAvatar(deps, user.id)
    const missing = `${user.id}/missing.png`
    const urls = await avatarUrls(deps.storage, [path, null, path, missing])
    expect([...urls.keys()]).toEqual([path])
    const response = await fetch(urls.get(path) as string)
    expect(response.ok).toBe(true)
  })

  it('returns an empty map without calling Storage for no paths', async () => {
    expect((await avatarUrls(deps.storage, [null])).size).toBe(0)
  })
})
