import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  listOfficerPermissions,
  saveOfficerPermissions,
} from '../../supabase/functions/_shared/officer-permissions/service.ts'
import type { AccessRole } from '../../supabase/functions/_shared/contracts/account.ts'
import {
  actorOf,
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

async function profiled(role: AccessRole) {
  const user = await createProfiledUser(db, role, { officerPermissions: [] })
  return { user, actor: await actorOf(db, user.id) }
}

describe('officer-permissions/list and save', () => {
  it('starts with every permission disabled and only managers can configure officers', async () => {
    const { user: officer, actor: officerActor } = await profiled('officer')
    const { actor: master } = await profiled('master')
    const { actor: admin } = await profiled('admin')
    const { actor: member } = await profiled('member')

    await expect(listOfficerPermissions(deps, master)).resolves.toMatchObject({
      officers: [{ id: officer.id, permissions: [] }],
    })
    await expect(listOfficerPermissions(deps, admin)).resolves.toMatchObject({
      officers: [{ id: officer.id, permissions: [] }],
    })
    await rejects(listOfficerPermissions(deps, officerActor), 'forbidden')
    await rejects(listOfficerPermissions(deps, member), 'forbidden')
  })

  it('saves only changed permissions and writes one audit entry per change', async () => {
    const { user: officer } = await profiled('officer')
    const { user: admin, actor } = await profiled('admin')

    await saveOfficerPermissions(deps, actor, {
      officerId: officer.id,
      permissions: ['events.view_full_roster', 'votes.view_ballots'],
    })
    await saveOfficerPermissions(deps, actor, {
      officerId: officer.id,
      permissions: ['events.view_full_roster', 'votes.view_ballots'],
    })

    await expect(
      db
        .selectFrom('app.audit_log')
        .select(['actor_id', 'target_user_id', 'category', 'action', 'details'])
        .orderBy('id')
        .execute(),
    ).resolves.toMatchObject([
      {
        actor_id: admin.id,
        target_user_id: officer.id,
        category: 'officer_permissions',
        details: { permission_code: 'events.view_full_roster', enabled: true },
      },
      {
        actor_id: admin.id,
        target_user_id: officer.id,
        category: 'officer_permissions',
        details: { permission_code: 'votes.view_ballots', enabled: true },
      },
    ])
  })

  it('rejects application action permissions without queue access', async () => {
    const { user: officer } = await profiled('officer')
    const { actor } = await profiled('admin')

    await rejects(
      saveOfficerPermissions(deps, actor, {
        officerId: officer.id,
        permissions: ['applications.decide_direct'],
      }),
      'validation_failed',
    )
  })

  it('cannot configure a profile that is no longer an officer', async () => {
    const { user: member } = await profiled('member')
    const { actor } = await profiled('admin')

    await rejects(
      saveOfficerPermissions(deps, actor, {
        officerId: member.id,
        permissions: ['events.manage'],
      }),
      'not_found',
    )
  })
})
