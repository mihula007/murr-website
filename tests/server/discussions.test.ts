import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppDeps } from '../../supabase/functions/_shared/app.ts'
import {
  GUEST,
  type Actor,
} from '../../supabase/functions/_shared/auth/actor.ts'
import type { AccessRole } from '../../supabase/functions/_shared/contracts/account.ts'
import type { ThreadRef } from '../../supabase/functions/_shared/contracts/discussions.ts'
import {
  discussionChanges,
  editMessage,
  listDiscussion,
  markDiscussionRead,
  messageReaders,
  messageReactions,
  reactToMessage,
  sendMessage,
} from '../../supabase/functions/_shared/discussions/service.ts'
import {
  closeEvent,
  createEvent,
  deleteEvent,
  getEvent,
  listEvents,
} from '../../supabase/functions/_shared/events/service.ts'
import {
  getListing,
  listListings,
  saveListing,
  unpublishListing,
} from '../../supabase/functions/_shared/market/service.ts'
import {
  getPublication,
  listPublications,
  savePublication,
  unpublishPublication,
} from '../../supabase/functions/_shared/publications/service.ts'
import {
  closeVote,
  createVote,
  getVote,
  listVotes,
} from '../../supabase/functions/_shared/votes/service.ts'
import {
  actorOf,
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

const later = (ms: number) => {
  now = new Date(now.getTime() + ms)
}

async function roleActor(role: AccessRole) {
  const user = await createProfiledUser(db, role)
  return { user, actor: await actorOf(db, user.id) }
}

const textDoc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

const material = (overrides: Record<string, unknown> = {}) => ({
  status: 'published',
  title: 'Материал',
  summary: null,
  content: textDoc('Текст материала.'),
  discussionEnabled: true,
  ...overrides,
})

async function makeEvent(officer: Actor): Promise<ThreadRef> {
  const event = await createEvent(deps, officer, {
    title: 'Рейд',
    type: 'pve',
    date: '2026-11-14',
    time: '20:00',
    description: 'Собираемся у портала',
  })
  return { parent: 'event', parentId: event.id }
}

async function makeVote(officer: Actor): Promise<ThreadRef> {
  const vote = await createVote(deps, officer, {
    title: 'Куда идём?',
    context: '',
    options: ['Башня', 'Пещера'],
  })
  return { parent: 'vote', parentId: vote.id }
}

async function makePublication(
  officer: Actor,
  overrides: Record<string, unknown> = {},
): Promise<ThreadRef> {
  const saved = await savePublication(
    deps,
    officer,
    material({
      category: 'news',
      showAuthor: true,
      attachments: [],
      ...overrides,
    }),
  )
  return { parent: 'publication', parentId: saved.id }
}

async function makeListing(
  member: Actor,
  overrides: Record<string, unknown> = {},
): Promise<ThreadRef> {
  const saved = await saveListing(
    deps,
    member,
    material({ category: 'sale', ...overrides }),
  )
  return { parent: 'market', parentId: saved.id }
}

const send = (
  actor: Actor,
  thread: ThreadRef,
  body: string,
  replyToId?: string,
) => sendMessage(deps, actor, { ...thread, body, replyToId })

async function notificationsOf(userId: string) {
  return db
    .selectFrom('app.user_notifications')
    .where('recipient_id', '=', userId)
    .select(['kind', 'target_kind', 'target_id', 'source_id'])
    .execute()
}

describe('discussions service', () => {
  it('rejects guests, applicants and readers for every operation', async () => {
    const officer = await roleActor('officer')
    const thread = await makeEvent(officer.actor)
    const message = await send(officer.actor, thread, 'Привет')
    const calls = (actor: Actor) => [
      listDiscussion(deps, actor, thread),
      discussionChanges(deps, actor, { ...thread, since: now.toISOString() }),
      send(actor, thread, 'Текст'),
      editMessage(deps, actor, { messageId: message.id, body: 'Т' }),
      reactToMessage(deps, actor, { messageId: message.id, emoji: '👍' }),
      markDiscussionRead(deps, actor, { ...thread, upTo: now.toISOString() }),
      messageReaders(deps, actor, { messageId: message.id }),
      messageReactions(deps, actor, { messageId: message.id }),
    ]
    for (const call of calls(GUEST)) {
      await rejects(call, 'not_authenticated')
    }
    for (const role of ['applicant', 'reader'] as const) {
      const { actor } = await roleActor(role)
      for (const call of calls(actor)) {
        await rejects(call, 'forbidden')
      }
    }
  })

  it('keeps threads of different parents apart and pages from newest', async () => {
    const officer = await roleActor('officer')
    const member = await roleActor('member')
    const event = await makeEvent(officer.actor)
    const vote = await makeVote(officer.actor)
    for (let index = 0; index < 5; index += 1) {
      later(1000)
      await send(member.actor, event, `Событие ${index}`)
    }
    await send(member.actor, vote, 'Голосование')
    const first = await listDiscussion(deps, member.actor, {
      ...event,
      limit: 3,
    })
    expect(first.items.map((m) => m.body)).toEqual([
      'Событие 4',
      'Событие 3',
      'Событие 2',
    ])
    expect(first.canWrite).toBe(true)
    const second = await listDiscussion(deps, member.actor, {
      ...event,
      limit: 3,
      cursor: first.nextCursor,
    })
    expect(second.items.map((m) => m.body)).toEqual(['Событие 1', 'Событие 0'])
    expect(second.nextCursor).toBeNull()
    const other = await listDiscussion(deps, member.actor, vote)
    expect(other.items.map((m) => m.body)).toEqual(['Голосование'])
    await rejects(
      listDiscussion(deps, member.actor, { ...event, cursor: 'broken' }),
      'validation_failed',
    )
  })

  it('validates the message text', async () => {
    const officer = await roleActor('officer')
    const thread = await makeEvent(officer.actor)
    await rejects(send(officer.actor, thread, '   '), 'validation_failed')
    await rejects(
      send(officer.actor, thread, 'я'.repeat(2001)),
      'validation_failed',
    )
    const message = await send(officer.actor, thread, '  <b>x</b>\nстрока  ')
    expect(message.body).toBe('<b>x</b>\nстрока')
    expect(message.author).toMatchObject({ state: 'shown', badge: 'officer' })
    expect(message.mine).toBe(true)
  })

  it('closes writing in a finished event or vote but keeps history', async () => {
    const officer = await roleActor('officer')
    const member = await roleActor('member')
    const event = await makeEvent(officer.actor)
    const vote = await makeVote(officer.actor)
    const inEvent = await send(member.actor, event, 'До закрытия')
    const inVote = await send(member.actor, vote, 'До завершения')
    await closeEvent(deps, officer.actor, { id: event.parentId })
    await closeVote(deps, officer.actor, { id: vote.parentId })
    for (const [thread, message] of [
      [event, inEvent],
      [vote, inVote],
    ] as const) {
      const page = await listDiscussion(deps, member.actor, thread)
      expect(page.canWrite).toBe(false)
      expect(page.items).toHaveLength(1)
      await rejects(send(member.actor, thread, 'После'), 'state_conflict')
      await rejects(
        editMessage(deps, member.actor, { messageId: message.id, body: 'Т' }),
        'state_conflict',
      )
      await rejects(
        reactToMessage(deps, member.actor, {
          messageId: message.id,
          emoji: '👍',
        }),
        'state_conflict',
      )
    }
  })

  it('follows publication visibility and discussion flag', async () => {
    const officer = await roleActor('officer')
    const otherOfficer = await roleActor('officer')
    const member = await roleActor('member')
    const admin = await roleActor('admin')
    const open = await makePublication(officer.actor)
    await send(member.actor, open, 'Спасибо за гайд')

    const disabled = await makePublication(officer.actor, {
      discussionEnabled: false,
    })
    expect((await listDiscussion(deps, member.actor, disabled)).canWrite).toBe(
      false,
    )
    await rejects(send(member.actor, disabled, 'Т'), 'state_conflict')

    const draft = await makePublication(officer.actor, { status: 'draft' })
    await rejects(listDiscussion(deps, member.actor, draft), 'not_found')
    await rejects(listDiscussion(deps, otherOfficer.actor, draft), 'not_found')
    const adminView = await listDiscussion(deps, admin.actor, draft)
    expect(adminView.canWrite).toBe(false)

    await unpublishPublication(deps, officer.actor, { id: open.parentId })
    await rejects(listDiscussion(deps, member.actor, open), 'not_found')
    const authorView = await listDiscussion(deps, officer.actor, open)
    expect(authorView.items).toHaveLength(1)
    expect(authorView.canWrite).toBe(false)
    await rejects(send(officer.actor, open, 'Т'), 'state_conflict')
  })

  it('follows market listing visibility', async () => {
    const seller = await roleActor('member')
    const buyer = await roleActor('member')
    const listing = await makeListing(seller.actor)
    const message = await send(buyer.actor, listing, 'Беру')
    expect(message.body).toBe('Беру')
    await unpublishListing(deps, seller.actor, { id: listing.parentId })
    await rejects(listDiscussion(deps, buyer.actor, listing), 'not_found')
    await rejects(send(seller.actor, listing, 'Т'), 'state_conflict')
  })

  it('lets only the author edit within five minutes', async () => {
    const officer = await roleActor('officer')
    const member = await roleActor('member')
    const admin = await roleActor('admin')
    const thread = await makeEvent(officer.actor)
    const message = await send(member.actor, thread, 'Черновой текст')
    await rejects(
      editMessage(deps, admin.actor, { messageId: message.id, body: 'Чужое' }),
      'forbidden',
    )
    await rejects(
      editMessage(deps, member.actor, { messageId: message.id, body: '  ' }),
      'validation_failed',
    )
    later(4 * 60 * 1000)
    const edited = await editMessage(deps, member.actor, {
      messageId: message.id,
      body: 'Исправленный текст',
    })
    expect(edited.body).toBe('Исправленный текст')
    expect(edited.editedAt).toBe(now.toISOString())
    later(60 * 1000)
    await rejects(
      editMessage(deps, member.actor, {
        messageId: message.id,
        body: 'Поздно',
      }),
      'state_conflict',
    )
  })

  it('toggles one reaction of each kind per account', async () => {
    const officer = await roleActor('officer')
    const member = await roleActor('member')
    const thread = await makeEvent(officer.actor)
    const message = await send(officer.actor, thread, 'Готовы?')
    const react = (actor: Actor, emoji: string) =>
      reactToMessage(deps, actor, { messageId: message.id, emoji })
    await react(member.actor, '👍')
    await react(member.actor, '🤡')
    await react(officer.actor, '👍')
    let state = await react(member.actor, '🤡')
    expect(state.reactions).toEqual([{ emoji: '👍', count: 2, mine: true }])
    state = await react(member.actor, '👍')
    expect(state.reactions).toEqual([{ emoji: '👍', count: 1, mine: false }])
    await rejects(react(member.actor, '😮'), 'validation_failed')
    const people = await messageReactions(deps, member.actor, {
      messageId: message.id,
    })
    expect(people.items).toEqual([
      expect.objectContaining({
        emoji: '👍',
        gameNickname: officer.user.nickname,
      }),
    ])
  })

  it('notifies reply and mention recipients once and never the sender', async () => {
    const officer = await roleActor('officer')
    const author = await roleActor('member')
    const mentioned = await roleActor('member')
    const reader = await roleActor('reader')
    const thread = await makeEvent(officer.actor)
    const original = await send(author.actor, thread, 'Кто идёт?')
    const reply = await send(
      officer.actor,
      thread,
      `@${author.user.nickname.toUpperCase()}, @${mentioned.user.nickname}! и @${officer.user.nickname} и @${reader.user.nickname} @нетакого`,
      original.id,
    )
    expect(reply.replyTo).toMatchObject({
      id: original.id,
      gameNickname: author.user.nickname,
      excerpt: 'Кто идёт?',
    })
    expect(await notificationsOf(author.user.id)).toEqual([
      {
        kind: 'discussion_reply',
        target_kind: 'event',
        target_id: thread.parentId,
        source_id: reply.id,
      },
    ])
    expect(await notificationsOf(mentioned.user.id)).toEqual([
      expect.objectContaining({ kind: 'discussion_mention' }),
    ])
    expect(await notificationsOf(officer.user.id)).toEqual([])
    expect(await notificationsOf(reader.user.id)).toEqual([])

    const other = await makeEvent(officer.actor)
    await rejects(
      send(author.actor, other, 'Ответ не туда', original.id),
      'validation_failed',
    )
  })

  it('reports changes since the last poll and asks to reset when too many', async () => {
    const officer = await roleActor('officer')
    const member = await roleActor('member')
    const thread = await makeEvent(officer.actor)
    const old = await send(member.actor, thread, 'Старое')
    later(60 * 1000)
    const since = now.toISOString()
    later(1000)
    const fresh = await send(officer.actor, thread, 'Новое')
    await reactToMessage(deps, officer.actor, {
      messageId: old.id,
      emoji: '🔥',
    })
    const changes = await discussionChanges(deps, member.actor, {
      ...thread,
      since,
    })
    expect(changes.reset).toBe(false)
    expect(changes.items.map((m) => m.id).sort()).toEqual(
      [old.id, fresh.id].sort(),
    )
    for (let index = 0; index < 101; index += 1) {
      await send(member.actor, thread, `Сообщение ${index}`)
    }
    const flood = await discussionChanges(deps, member.actor, {
      ...thread,
      since,
    })
    expect(flood).toMatchObject({ reset: true, items: [] })
  })

  it('tracks reads and shows readers to the author, officers and admin', async () => {
    const officer = await roleActor('officer')
    const author = await roleActor('member')
    const other = await roleActor('member')
    const thread = await makeEvent(officer.actor)
    const message = await send(author.actor, thread, 'Прочитайте')
    expect(
      (await listDiscussion(deps, author.actor, thread)).othersReadUpTo,
    ).toBeNull()
    later(1000)
    await markDiscussionRead(deps, other.actor, {
      ...thread,
      upTo: now.toISOString(),
    })
    // Отметка не опускается и не уходит в будущее.
    await markDiscussionRead(deps, other.actor, {
      ...thread,
      upTo: '2026-11-01T00:00:00.000Z',
    })
    const result = await markDiscussionRead(deps, other.actor, {
      ...thread,
      upTo: '2030-01-01T00:00:00.000Z',
    })
    expect(result.readUpTo).toBe(now.toISOString())
    const page = await listDiscussion(deps, author.actor, thread)
    expect(page.othersReadUpTo).toBe(now.toISOString())

    const expected = {
      items: [{ gameNickname: other.user.nickname, avatarUrl: null }],
      truncated: false,
    }
    expect(
      await messageReaders(deps, author.actor, { messageId: message.id }),
    ).toEqual(expected)
    expect(
      await messageReaders(deps, officer.actor, { messageId: message.id }),
    ).toEqual(expected)
    await rejects(
      messageReaders(deps, other.actor, { messageId: message.id }),
      'forbidden',
    )
  })

  it('counts messages on parent cards', async () => {
    const officer = await roleActor('officer')
    const member = await roleActor('member')
    const event = await makeEvent(officer.actor)
    const vote = await makeVote(officer.actor)
    const publication = await makePublication(officer.actor)
    const listing = await makeListing(member.actor)
    await send(member.actor, event, 'Раз')
    await send(member.actor, event, 'Два')
    await send(member.actor, vote, 'Три')
    await send(member.actor, publication, 'Четыре')
    await send(officer.actor, listing, 'Пять')
    const viewer = member.actor
    expect(
      (await listEvents(deps, viewer, { tab: 'active' })).items[0]
        ?.messageCount,
    ).toBe(2)
    expect(
      (await getEvent(deps, viewer, { id: event.parentId })).messageCount,
    ).toBe(2)
    expect(
      (await listVotes(deps, viewer, { tab: 'active' })).items[0]?.messageCount,
    ).toBe(1)
    expect(
      (await getVote(deps, viewer, { id: vote.parentId })).messageCount,
    ).toBe(1)
    expect(
      (await listPublications(deps, viewer, { tab: 'published' })).items[0]
        ?.messageCount,
    ).toBe(1)
    expect(
      (await getPublication(deps, viewer, { id: publication.parentId }))
        .messageCount,
    ).toBe(1)
    expect(
      (await listListings(deps, viewer, { tab: 'published' })).items[0]
        ?.messageCount,
    ).toBe(1)
    expect(
      (await getListing(deps, viewer, { id: listing.parentId })).messageCount,
    ).toBe(1)
  })

  it('removes the thread together with a deleted parent', async () => {
    const officer = await roleActor('officer')
    const thread = await makeEvent(officer.actor)
    const message = await send(officer.actor, thread, 'Исчезнет')
    await deleteEvent(deps, officer.actor, { id: thread.parentId })
    await rejects(
      reactToMessage(deps, officer.actor, {
        messageId: message.id,
        emoji: '👍',
      }),
      'not_found',
    )
  })
})
