import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppDeps } from '../../supabase/functions/_shared/app.ts'
import {
  GUEST,
  type Actor,
} from '../../supabase/functions/_shared/auth/actor.ts'
import type { AccessRole } from '../../supabase/functions/_shared/contracts/account.ts'
import { NUMBERED_PAGE_SIZE } from '../../supabase/functions/_shared/contracts/paging.ts'
import {
  deleteListing,
  getListing,
  listListings,
  saveListing,
  unpublishListing,
} from '../../supabase/functions/_shared/market/service.ts'
import {
  actorOf,
  createAuthUser,
  createProfiledUser,
  resetAppData,
  testDb,
  testDeps,
} from './support.ts'

const db = testDb()
let now = new Date('2026-11-12T09:00:00Z')
const deps: AppDeps = { ...testDeps(db), now: () => now }

beforeEach(async () => {
  now = new Date('2026-11-12T09:00:00Z')
  await resetAppData(db)
})
afterAll(() => db.destroy())

const rejects = (promise: Promise<unknown>, code: string) =>
  expect(promise).rejects.toMatchObject({ code })

async function roleActor(role: AccessRole) {
  const user = await createProfiledUser(db, role)
  return { user, actor: await actorOf(db, user.id) }
}

const listing = (overrides: Record<string, unknown> = {}) => ({
  status: 'draft',
  category: 'sale',
  title: 'Продам меч',
  summary: null,
  content: {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Цена договорная, пишите в игре. ' },
          {
            type: 'text',
            text: 'Скриншот',
            marks: [
              {
                type: 'link',
                attrs: { href: 'https://example.com/sword.png' },
              },
            ],
          },
        ],
      },
    ],
  },
  discussionEnabled: false,
  ...overrides,
})

async function auditActions() {
  const rows = await db
    .selectFrom('app.audit_log')
    .select('action')
    .where('category', '=', 'market')
    .orderBy('id')
    .execute()
  return rows.map((row) => row.action)
}

describe('market: access (MKT-01, ACL-12, Q-04)', () => {
  it('is closed to guests, applicants and readers', async () => {
    const incomplete = await actorOf(db, (await createAuthUser()).id)
    const outsiders: [Actor, string][] = [
      [GUEST, 'not_authenticated'],
      [incomplete, 'registration_incomplete'],
      [(await roleActor('applicant')).actor, 'forbidden'],
      [(await roleActor('reader')).actor, 'forbidden'],
    ]
    for (const [actor, code] of outsiders) {
      await rejects(listListings(deps, actor, {}), code)
      await rejects(saveListing(deps, actor, listing()), code)
    }
  })

  it('lets members and officers manage only their own listings (приёмка MKT 1–2)', async () => {
    const member = await roleActor('member')
    const officer = await roleActor('officer')
    const draft = await saveListing(deps, member.actor, listing())
    expect(draft).toMatchObject({
      status: 'draft',
      canManage: true,
      author: { state: 'shown', gameNickname: member.user.nickname },
    })

    // Чужой черновик офицеру недоступен ни чтением, ни правкой.
    await rejects(
      getListing(deps, officer.actor, { id: draft.id }),
      'not_found',
    )
    await rejects(
      saveListing(deps, officer.actor, { ...listing(), id: draft.id }),
      'not_found',
    )
    expect(
      (await listListings(deps, officer.actor, { tab: 'drafts' })).items,
    ).toEqual([])
    expect((await listListings(deps, officer.actor, {})).items).toEqual([])

    const published = await saveListing(deps, member.actor, {
      ...listing({ status: 'published' }),
      id: draft.id,
      expectedUpdatedAt: draft.updatedAt,
    })
    const seen = await getListing(deps, officer.actor, { id: draft.id })
    expect(seen).toMatchObject({ status: 'published', canManage: false })
    await rejects(
      saveListing(deps, officer.actor, { ...listing(), id: published.id }),
      'forbidden',
    )
    await rejects(
      unpublishListing(deps, officer.actor, { id: published.id }),
      'forbidden',
    )
    await rejects(
      deleteListing(deps, officer.actor, { id: published.id }),
      'forbidden',
    )

    const own = await saveListing(
      deps,
      officer.actor,
      listing({ status: 'published', category: 'buy', title: 'Куплю щит' }),
    )
    expect(own.canManage).toBe(true)
  })

  it('lets an admin see and edit any listing, including drafts (MKT-07, приёмка MKT 3)', async () => {
    const member = await roleActor('member')
    const admin = await roleActor('admin')
    const draft = await saveListing(deps, member.actor, listing())
    expect(
      (await listListings(deps, admin.actor, { tab: 'drafts' })).items.map(
        (item) => item.id,
      ),
    ).toEqual([draft.id])
    const edited = await saveListing(deps, admin.actor, {
      ...listing({ title: 'Исправлено администратором' }),
      id: draft.id,
    })
    expect(edited).toMatchObject({
      title: 'Исправлено администратором',
      canManage: true,
      author: { state: 'shown', gameNickname: member.user.nickname },
    })
    // Файлы к объявлениям не принимаются (MKT-08), ссылка сохраняется.
    await rejects(
      saveListing(deps, admin.actor, {
        ...listing(),
        attachments: [{ path: 'uploads/x/a.png', fileName: 'a.png' }],
      }),
      'validation_failed',
    )
    expect(JSON.stringify(edited.content)).toContain(
      'https://example.com/sword.png',
    )
    await deleteListing(deps, admin.actor, { id: draft.id })
    await rejects(getListing(deps, member.actor, { id: draft.id }), 'not_found')
  })

  it('hides an unpublished listing from others (приёмка MKT 4) and audits actions', async () => {
    const author = await roleActor('member')
    const other = await roleActor('member')
    const published = await saveListing(
      deps,
      author.actor,
      listing({ status: 'published' }),
    )
    expect((await listListings(deps, other.actor, {})).items).toHaveLength(1)
    await unpublishListing(deps, author.actor, { id: published.id })
    expect((await listListings(deps, other.actor, {})).items).toEqual([])
    await rejects(
      getListing(deps, other.actor, { id: published.id }),
      'not_found',
    )
    await deleteListing(deps, author.actor, { id: published.id })
    expect(await auditActions()).toEqual([
      'listing_published',
      'listing_unpublished',
      'listing_deleted',
    ])
    // Удаление объявления не удаляет автора (MKT-09).
    expect(
      await db
        .selectFrom('app.profiles')
        .select('id')
        .where('id', '=', author.user.id)
        .executeTakeFirst(),
    ).toBeTruthy()
  })

  it('loses access when a member becomes a reader', async () => {
    const member = await roleActor('member')
    const saved = await saveListing(
      deps,
      member.actor,
      listing({ status: 'published' }),
    )
    await db
      .updateTable('app.profiles')
      .set({ access_role: 'reader' })
      .where('id', '=', member.user.id)
      .execute()
    const reader = await actorOf(db, member.user.id)
    await rejects(getListing(deps, reader, { id: saved.id }), 'forbidden')
    const other = await roleActor('member')
    expect((await listListings(deps, other.actor, {})).items).toHaveLength(1)
  })
})

describe('market: feed (MKT-11, Q-55)', () => {
  it('searches category, title, summary, author and text; pages by 50', async () => {
    const member = await roleActor('member')
    await saveListing(
      deps,
      member.actor,
      listing({
        status: 'published',
        category: 'free',
        title: 'Зелья',
        summary: 'Остатки после рейда',
      }),
    )
    await saveListing(
      deps,
      member.actor,
      listing({ status: 'published', category: 'trade', title: 'Меняю руны' }),
    )
    const search = async (value: string) =>
      (await listListings(deps, member.actor, { search: value })).items
        .map((item) => item.title)
        .sort()
    expect(await search('даром')).toEqual(['Зелья'])
    expect(await search('ОСТАТКИ')).toEqual(['Зелья'])
    expect(await search('руны')).toEqual(['Меняю руны'])
    expect(await search('договорная')).toEqual(['Зелья', 'Меняю руны'])
    expect(await search(member.user.nickname)).toEqual(['Зелья', 'Меняю руны'])
    expect(await search('_')).toEqual([])

    for (let index = 0; index < NUMBERED_PAGE_SIZE; index += 1) {
      now = new Date(Date.UTC(2026, 10, 13, 0, index))
      await saveListing(
        deps,
        member.actor,
        listing({ status: 'published', title: `Лот ${index}` }),
      )
    }
    const second = await listListings(deps, member.actor, { page: 2 })
    expect(second).toMatchObject({
      page: 2,
      pageCount: 2,
      total: NUMBERED_PAGE_SIZE + 2,
    })
    expect(second.items).toHaveLength(2)
  })

  it('lists at most 50 drafts and reports truncation', async () => {
    const member = await roleActor('member')
    for (let index = 0; index <= NUMBERED_PAGE_SIZE; index += 1) {
      await saveListing(
        deps,
        member.actor,
        listing({ title: `Черновик ${index}` }),
      )
    }
    const drafts = await listListings(deps, member.actor, { tab: 'drafts' })
    expect(drafts.items).toHaveLength(NUMBERED_PAGE_SIZE)
    expect(drafts.truncated).toBe(true)
  })
})
