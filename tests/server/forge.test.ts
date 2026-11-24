import { afterAll, describe, expect, it } from 'vitest'
import { GUEST } from '../../supabase/functions/_shared/auth/actor.ts'
import { listForgeCatalog } from '../../supabase/functions/_shared/forge/service.ts'
import { actorOf, createProfiledUser, testDb } from './support.ts'

const db = testDb()
afterAll(() => db.destroy())

describe('forge/catalog', () => {
  it('returns title catalog in stable cursor pages without gaps', async () => {
    const user = await createProfiledUser(db, 'member')
    const actor = await actorOf(db, user.id)
    const items = []
    let cursor: string | null = null
    do {
      const page = await listForgeCatalog(actor, {
        kind: 'titles',
        limit: 13,
        cursor,
      })
      items.push(...page.items)
      cursor = page.nextCursor
    } while (cursor)
    expect(items).toHaveLength(168)
    expect(new Set(items.map((item) => item.id)).size).toBe(168)
  })
  it('rejects a guest before returning any catalog', async () => {
    await expect(
      listForgeCatalog(GUEST, { kind: 'titles' }),
    ).rejects.toMatchObject({ code: 'not_authenticated' })
  })
  it('rejects applicants and readers', async () => {
    for (const role of ['applicant', 'reader'] as const) {
      const user = await createProfiledUser(db, role)
      await expect(
        listForgeCatalog(await actorOf(db, user.id), { kind: 'titles' }),
      ).rejects.toMatchObject({ code: 'forbidden' })
    }
  })
  it('applies search and equipment-slot filters before paging', async () => {
    const user = await createProfiledUser(db, 'member')
    const actor = await actorOf(db, user.id)
    const equipment = await listForgeCatalog(actor, {
      kind: 'equipment',
      slot: 'armor',
      limit: 50,
    })
    expect(equipment.items).toHaveLength(12)
    expect(equipment.items.every((item) => item.slot === 'armor')).toBe(true)
    const titles = await listForgeCatalog(actor, {
      kind: 'titles',
      search: 'владычицы',
      limit: 50,
    })
    expect(titles.items.length).toBeGreaterThan(0)
    expect(
      titles.items.every((item) =>
        item.name.toLowerCase().includes('владычицы'),
      ),
    ).toBe(true)
  })
})
