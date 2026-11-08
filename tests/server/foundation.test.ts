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
import { withTransaction } from '../../supabase/functions/_shared/db/client.ts'
import {
  createAuthUser,
  createProfiledUser,
  env,
  resetAppData,
  signIn,
  testDb,
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
