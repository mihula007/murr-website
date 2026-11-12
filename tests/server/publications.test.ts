import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppDeps } from '../../supabase/functions/_shared/app.ts'
import {
  GUEST,
  type Actor,
} from '../../supabase/functions/_shared/auth/actor.ts'
import type { AccessRole } from '../../supabase/functions/_shared/contracts/account.ts'
import { NUMBERED_PAGE_SIZE } from '../../supabase/functions/_shared/contracts/paging.ts'
import { PUBLICATION_BUCKET } from '../../supabase/functions/_shared/publications/files.ts'
import {
  createPublicationUpload,
  deletePublication,
  discardPublicationUploads,
  getPublication,
  listPublications,
  savePublication,
  unpublishPublication,
} from '../../supabase/functions/_shared/publications/service.ts'
import {
  actorOf,
  createAuthUser,
  createProfiledUser,
  env,
  PNG_BYTES,
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

const textDoc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

const material = (overrides: Record<string, unknown> = {}) => ({
  status: 'draft',
  category: 'guide',
  title: 'Гайд по рейду',
  summary: null,
  content: textDoc('Собираемся у портала в восемь.'),
  showAuthor: true,
  discussionEnabled: false,
  attachments: [],
  ...overrides,
})

/** Загрузка файла тем же путём, что и браузер: ссылка → uploadToSignedUrl. */
async function upload(
  actor: Actor,
  bytes: Uint8Array = PNG_BYTES,
  contentType = 'image/png',
) {
  const { path, token } = await createPublicationUpload(deps, actor, {
    contentType: 'image/png',
  })
  const client = createClient(env('API_URL'), env('ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await client.storage
    .from(PUBLICATION_BUCKET)
    .uploadToSignedUrl(
      path,
      token,
      new Blob([bytes as BlobPart], { type: contentType }),
      {
        contentType,
      },
    )
  if (error) {
    throw error
  }
  return path
}

async function fileExists(path: string) {
  return (await deps.storage.read(PUBLICATION_BUCKET, path)) !== null
}

async function auditActions() {
  const rows = await db
    .selectFrom('app.audit_log')
    .select('action')
    .where('category', '=', 'publications')
    .orderBy('id')
    .execute()
  return rows.map((row) => row.action)
}

describe('publications: access (ACL-11, Q-02, Q-03)', () => {
  it('lets only officers and admins create, and only internal roles read', async () => {
    const incomplete = await actorOf(db, (await createAuthUser()).id)
    const outsiders: [Actor, string][] = [
      [GUEST, 'not_authenticated'],
      [incomplete, 'registration_incomplete'],
      [(await roleActor('applicant')).actor, 'forbidden'],
      [(await roleActor('reader')).actor, 'forbidden'],
    ]
    for (const [actor, code] of outsiders) {
      await rejects(listPublications(deps, actor, {}), code)
      await rejects(savePublication(deps, actor, material()), code)
      await rejects(
        createPublicationUpload(deps, actor, { contentType: 'image/png' }),
        code,
      )
    }
    const member = await roleActor('member')
    await rejects(savePublication(deps, member.actor, material()), 'forbidden')
    await rejects(
      listPublications(deps, member.actor, { tab: 'drafts' }),
      'forbidden',
    )
    await rejects(
      createPublicationUpload(deps, member.actor, { contentType: 'image/png' }),
      'forbidden',
    )
    const feed = await listPublications(deps, member.actor, {})
    expect(feed).toMatchObject({
      items: [],
      page: 1,
      pageCount: 1,
      canCreate: false,
    })

    const officer = await roleActor('officer')
    const saved = await savePublication(deps, officer.actor, material())
    expect(saved).toMatchObject({ status: 'draft', canManage: true })
    const admin = await roleActor('admin')
    expect(
      (await savePublication(deps, admin.actor, material())).canManage,
    ).toBe(true)
  })

  it('hides drafts from everyone except the author and admins (PUB-05, приёмка PUB 1)', async () => {
    const author = await roleActor('officer')
    const otherOfficer = await roleActor('officer')
    const member = await roleActor('member')
    const admin = await roleActor('admin')
    const draft = await savePublication(deps, author.actor, material())

    for (const { actor } of [member, otherOfficer]) {
      await rejects(getPublication(deps, actor, { id: draft.id }), 'not_found')
    }
    expect((await listPublications(deps, member.actor, {})).items).toEqual([])
    expect(
      (await listPublications(deps, otherOfficer.actor, { tab: 'drafts' }))
        .items,
    ).toEqual([])
    expect(
      (await listPublications(deps, author.actor, { tab: 'drafts' })).items,
    ).toHaveLength(1)
    expect(
      (await listPublications(deps, admin.actor, { tab: 'drafts' })).items,
    ).toHaveLength(1)
    expect(
      (await getPublication(deps, admin.actor, { id: draft.id })).canManage,
    ).toBe(true)

    await savePublication(deps, author.actor, {
      ...material(),
      id: draft.id,
      status: 'published',
    })
    const read = await getPublication(deps, member.actor, { id: draft.id })
    expect(read).toMatchObject({ status: 'published', canManage: false })
    expect(read.content).toEqual(textDoc('Собираемся у портала в восемь.'))
    expect((await listPublications(deps, member.actor, {})).items).toHaveLength(
      1,
    )
  })

  it('lets an officer manage only own materials; admin manages any (PUB-06)', async () => {
    const author = await roleActor('officer')
    const other = await roleActor('officer')
    const admin = await roleActor('admin')
    const published = await savePublication(
      deps,
      author.actor,
      material({ status: 'published' }),
    )
    expect(
      (await getPublication(deps, other.actor, { id: published.id })).canManage,
    ).toBe(false)
    await rejects(
      savePublication(deps, other.actor, { ...material(), id: published.id }),
      'forbidden',
    )
    await rejects(
      unpublishPublication(deps, other.actor, { id: published.id }),
      'forbidden',
    )
    await rejects(
      deletePublication(deps, other.actor, { id: published.id }),
      'forbidden',
    )

    const edited = await savePublication(deps, admin.actor, {
      ...material({ status: 'published', title: 'Правка администратора' }),
      id: published.id,
    })
    // Автор и время создания не меняются при правке (PUB-06).
    expect(edited.author).toEqual({
      state: 'shown',
      gameNickname: author.user.nickname,
    })
    expect(edited.createdAt).toBe(published.createdAt)
    expect(edited.title).toBe('Правка администратора')

    const unpublished = await unpublishPublication(deps, admin.actor, {
      id: published.id,
    })
    expect(unpublished.status).toBe('draft')
    await rejects(
      unpublishPublication(deps, admin.actor, { id: published.id }),
      'state_conflict',
    )
    await deletePublication(deps, admin.actor, { id: published.id })
    await rejects(
      getPublication(deps, admin.actor, { id: published.id }),
      'not_found',
    )
    expect(await auditActions()).toEqual([
      'publication_published',
      'publication_updated',
      'publication_unpublished',
      'publication_deleted',
    ])
  })

  it('loses editing rights when an officer is demoted', async () => {
    const author = await roleActor('officer')
    const saved = await savePublication(
      deps,
      author.actor,
      material({ status: 'published' }),
    )
    await db
      .updateTable('app.profiles')
      .set({ access_role: 'member' })
      .where('id', '=', author.user.id)
      .execute()
    const demoted = await actorOf(db, author.user.id)
    await rejects(
      savePublication(deps, demoted, { ...material(), id: saved.id }),
      'forbidden',
    )
    expect(
      (await getPublication(deps, demoted, { id: saved.id })).canManage,
    ).toBe(false)
  })
})

describe('publications: content and signature', () => {
  it('hides the signature from readers but not from editors (PUB-07, приёмка PUB 2)', async () => {
    const author = await roleActor('officer')
    const member = await roleActor('member')
    const admin = await roleActor('admin')
    const saved = await savePublication(
      deps,
      author.actor,
      material({ status: 'published', showAuthor: false }),
    )
    expect(
      (await getPublication(deps, member.actor, { id: saved.id })).author,
    ).toBe(null)
    expect(
      (await listPublications(deps, member.actor, {})).items[0]?.author,
    ).toBe(null)
    expect(
      (await getPublication(deps, admin.actor, { id: saved.id })).author,
    ).toEqual({ state: 'shown', gameNickname: author.user.nickname })
    // Поиск по нику не раскрывает скрытого автора (PUB-07).
    expect(
      (
        await listPublications(deps, member.actor, {
          search: author.user.nickname,
        })
      ).items,
    ).toEqual([])
    expect(
      (
        await listPublications(deps, admin.actor, {
          search: author.user.nickname,
        })
      ).items,
    ).toHaveLength(1)
  })

  it('rejects empty, unsafe and malformed content (PUB-03, PUB-12)', async () => {
    const officer = await roleActor('officer')
    await rejects(
      savePublication(deps, officer.actor, material({ title: '  ' })),
      'validation_failed',
    )
    await rejects(
      savePublication(
        deps,
        officer.actor,
        material({
          content: { type: 'doc', content: [{ type: 'paragraph' }] },
        }),
      ),
      'validation_failed',
    )
    await rejects(
      savePublication(
        deps,
        officer.actor,
        material({
          content: { type: 'doc', content: [{ type: 'horizontalRule' }] },
        }),
      ),
      'validation_failed',
    )
    await rejects(
      savePublication(
        deps,
        officer.actor,
        material({
          content: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'x',
                    marks: [
                      { type: 'link', attrs: { href: 'javascript:alert(1)' } },
                    ],
                  },
                ],
              },
            ],
          },
        }),
      ),
      'validation_failed',
    )
    await rejects(
      savePublication(
        deps,
        officer.actor,
        material({ content: '<p onclick="alert(1)">html</p>' }),
      ),
      'validation_failed',
    )
    await rejects(
      savePublication(deps, officer.actor, material({ category: 'poem' })),
      'validation_failed',
    )
  })

  it('rejects a stale version instead of overwriting it', async () => {
    const author = await roleActor('officer')
    const admin = await roleActor('admin')
    const saved = await savePublication(deps, author.actor, material())
    now = new Date('2026-11-12T09:05:00Z')
    await savePublication(deps, admin.actor, {
      ...material({ title: 'Админ' }),
      id: saved.id,
      expectedUpdatedAt: saved.updatedAt,
    })
    await rejects(
      savePublication(deps, author.actor, {
        ...material({ title: 'Автор' }),
        id: saved.id,
        expectedUpdatedAt: saved.updatedAt,
      }),
      'state_conflict',
    )
  })
})

describe('publications: feed (PUB-01, PUB-09, Q-55)', () => {
  it('pages the published feed by 50, newest update first', async () => {
    const officer = await roleActor('officer')
    const member = await roleActor('member')
    const total = NUMBERED_PAGE_SIZE + 3
    for (let index = 0; index < total; index += 1) {
      now = new Date(Date.UTC(2026, 10, 1, 0, index))
      await savePublication(
        deps,
        officer.actor,
        material({ status: 'published', title: `Материал ${index}` }),
      )
    }
    const first = await listPublications(deps, member.actor, {})
    expect(first).toMatchObject({ page: 1, pageCount: 2, total })
    expect(first.items).toHaveLength(NUMBERED_PAGE_SIZE)
    expect(first.items[0]?.title).toBe(`Материал ${total - 1}`)
    const second = await listPublications(deps, member.actor, { page: 2 })
    expect(second.items.map((item) => item.title)).toEqual([
      'Материал 2',
      'Материал 1',
      'Материал 0',
    ])
    expect(
      (await listPublications(deps, member.actor, { page: 9 })).items,
    ).toEqual([])
  })

  it('searches title, summary, text, category, author and file names case-insensitively', async () => {
    const officer = await roleActor('officer')
    const member = await roleActor('member')
    const path = await upload(officer.actor)
    await savePublication(
      deps,
      officer.actor,
      material({
        status: 'published',
        category: 'rules',
        title: 'Устав',
        summary: 'Короткий АНОНС',
        content: textDoc('Порядок распределения ЛУТА'),
        attachments: [{ path, fileName: 'Схема-Крепости.png' }],
      }),
    )
    await savePublication(
      deps,
      officer.actor,
      material({ status: 'published', title: 'Другое', category: 'news' }),
    )
    const search = async (value: string) =>
      (await listPublications(deps, member.actor, { search: value })).items.map(
        (item) => item.title,
      )
    expect(await search('устав')).toEqual(['Устав'])
    expect(await search('анонс')).toEqual(['Устав'])
    expect(await search('лута')).toEqual(['Устав'])
    expect(await search('правила')).toEqual(['Устав'])
    expect(await search('крепости')).toEqual(['Устав'])
    expect(await search('100%')).toEqual([])
    expect((await search(officer.user.nickname.toUpperCase())).sort()).toEqual([
      'Другое',
      'Устав',
    ])
    expect(
      (
        await listPublications(deps, member.actor, { category: 'news' })
      ).items.map((item) => item.title),
    ).toEqual(['Другое'])
  })
})

describe('publications: attachments (PUB-13, PUB-14, PUB-16, Q-11)', () => {
  it('attaches verified images and shows them with signed links', async () => {
    const officer = await roleActor('officer')
    const member = await roleActor('member')
    const path = await upload(officer.actor)
    const saved = await savePublication(
      deps,
      officer.actor,
      material({
        status: 'published',
        content: { type: 'doc', content: [{ type: 'paragraph' }] },
        attachments: [{ path, fileName: 'карта.png' }],
      }),
    )
    const read = await getPublication(deps, member.actor, { id: saved.id })
    expect(read.attachments).toEqual([
      { path, fileName: 'карта.png', url: expect.stringContaining('token=') },
    ])
    expect(
      (await listPublications(deps, member.actor, {})).items[0]?.coverUrl,
    ).toContain('token=')
  })

  it('rejects wrong types, oversized files and other users’ files (приёмка PUB 4)', async () => {
    const officer = await roleActor('officer')
    const other = await roleActor('officer')
    const notImage = await upload(
      officer.actor,
      new TextEncoder().encode('%PDF-1.7 not an image'),
    )
    await rejects(
      savePublication(
        deps,
        officer.actor,
        material({ attachments: [{ path: notImage, fileName: 'a.png' }] }),
      ),
      'publication_file_invalid',
    )
    const foreign = await upload(other.actor)
    await rejects(
      savePublication(
        deps,
        officer.actor,
        material({ attachments: [{ path: foreign, fileName: 'a.png' }] }),
      ),
      'publication_file_invalid',
    )
    await rejects(
      savePublication(
        deps,
        officer.actor,
        material({
          attachments: [
            { path: `uploads/${officer.user.id}/../x.png`, fileName: 'a.png' },
          ],
        }),
      ),
      'publication_file_invalid',
    )
    // Больше 1 МБ не принимает уже bucket (вторая линия — сервис).
    const big = new Uint8Array(1024 * 1024 + 1)
    big.set(PNG_BYTES)
    await expect(upload(officer.actor, big)).rejects.toBeTruthy()
    // Файл уже привязан к чужой публикации.
    const taken = await upload(other.actor)
    await savePublication(
      deps,
      other.actor,
      material({ attachments: [{ path: taken, fileName: 'a.png' }] }),
    )
    await rejects(
      savePublication(
        deps,
        officer.actor,
        material({ attachments: [{ path: taken, fileName: 'a.png' }] }),
      ),
      'publication_file_invalid',
    )
    await rejects(
      savePublication(
        deps,
        officer.actor,
        material({
          attachments: Array.from({ length: 11 }, (_, index) => ({
            path: `uploads/${officer.user.id}/${index}.png`,
            fileName: 'a.png',
          })),
        }),
      ),
      'validation_failed',
    )
  })

  it('removes detached, deleted and discarded files', async () => {
    const officer = await roleActor('officer')
    const first = await upload(officer.actor)
    const second = await upload(officer.actor)
    const saved = await savePublication(
      deps,
      officer.actor,
      material({
        attachments: [
          { path: first, fileName: '1.png' },
          { path: second, fileName: '2.png' },
        ],
      }),
    )
    await savePublication(deps, officer.actor, {
      ...material({ attachments: [{ path: second, fileName: '2.png' }] }),
      id: saved.id,
    })
    expect(await fileExists(first)).toBe(false)
    expect(await fileExists(second)).toBe(true)

    await deletePublication(deps, officer.actor, { id: saved.id })
    expect(await fileExists(second)).toBe(false)

    const discarded = await upload(officer.actor)
    const attached = await upload(officer.actor)
    await savePublication(
      deps,
      officer.actor,
      material({ attachments: [{ path: attached, fileName: 'a.png' }] }),
    )
    const { removed } = await discardPublicationUploads(deps, officer.actor, {
      paths: [discarded, attached, `uploads/${randomUUID()}/x.png`],
    })
    expect(removed).toBe(1)
    expect(await fileExists(discarded)).toBe(false)
    expect(await fileExists(attached)).toBe(true)
  })

  it('cleans up abandoned uploads older than a day on the next save', async () => {
    const officer = await roleActor('officer')
    now = new Date('2026-11-10T09:00:00Z')
    const abandoned = await upload(officer.actor)
    now = new Date('2026-11-12T09:00:00Z')
    const fresh = await upload(officer.actor)
    await savePublication(deps, officer.actor, material())
    expect(await fileExists(abandoned)).toBe(false)
    expect(await fileExists(fresh)).toBe(true)
  })
})
