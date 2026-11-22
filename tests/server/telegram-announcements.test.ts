import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppDeps } from '../../supabase/functions/_shared/app.ts'
import { GUEST } from '../../supabase/functions/_shared/auth/actor.ts'
import { deliverAnnouncement } from '../../supabase/functions/_shared/telegram/announcements.ts'
import { telegramRepository } from '../../supabase/functions/_shared/telegram/repository.ts'
import {
  sendAnnouncement,
  broadcastRecipients,
} from '../../supabase/functions/_shared/broadcasts/service.ts'
import type { AccessRole } from '../../supabase/functions/_shared/contracts/account.ts'
import {
  closeEvent,
  createEvent,
  deleteEvent,
  respondToEvent,
} from '../../supabase/functions/_shared/events/service.ts'
import {
  answerData,
  changeData,
  voteAnswerData,
  voteChangeData,
} from '../../supabase/functions/_shared/messenger/callback-data.ts'
import { CALLBACK_TEXTS } from '../../supabase/functions/_shared/telegram/messages.ts'
import {
  handleTelegramWebhook,
  unlinkTelegram,
} from '../../supabase/functions/_shared/telegram/service.ts'
import {
  castBallot,
  closeVote,
  createVote,
} from '../../supabase/functions/_shared/votes/service.ts'
import {
  actorOf,
  createProfiledUser,
  fakeTelegram,
  resetAppData,
  testDb,
  testDeps,
  webhookHeaders,
} from './support.ts'

const db = testDb()
let fake: ReturnType<typeof fakeTelegram>
let deps: AppDeps

beforeEach(async () => {
  await resetAppData(db)
  fake = fakeTelegram()
  deps = { ...testDeps(db), telegram: fake.telegram }
})
afterAll(() => db.destroy())

const rejects = (promise: Promise<unknown>, code: string, reason?: string) =>
  expect(promise).rejects.toMatchObject({
    code,
    ...(reason ? { fields: { reason } } : {}),
  })

const eventFields = {
  title: 'Рейд',
  type: 'pve',
  date: '2099-11-14',
  time: '20:00',
  description: 'Собираемся у портала',
}

let chatCounter = 10_000

/** Участник с привязанным Telegram (фикстура в обход вебхука). */
async function linked(role: AccessRole) {
  const user = await createProfiledUser(db, role)
  const chatId = chatCounter++
  await db
    .insertInto('app.telegram_links')
    .values({
      user_id: user.id,
      telegram_user_id: chatId,
      chat_id: chatId,
      display_name: user.nickname,
    })
    .execute()
  return { user, chatId, actor: await actorOf(db, user.id) }
}

async function officerWithEvent() {
  const officer = await createProfiledUser(db, 'officer')
  const actor = await actorOf(db, officer.id)
  const event = await createEvent(deps, actor, eventFields)
  return { actor, event }
}

const sentTo = (chatId: number) =>
  fake.calls.filter((c) => c.method === 'sendHtml' && c.chatId === chatId)

/** Номер сообщения, отправленного участнику последним. */
async function activeMessageId(eventId: string, userId: string) {
  const row = await db
    .selectFrom('app.telegram_event_messages')
    .select('message_id')
    .where('event_id', '=', eventId)
    .where('user_id', '=', userId)
    .executeTakeFirst()
  return row ? Number(row.message_id) : null
}

async function activeVoteMessageId(voteId: string, userId: string) {
  const row = await db
    .selectFrom('app.telegram_vote_messages')
    .select('message_id')
    .where('vote_id', '=', voteId)
    .where('user_id', '=', userId)
    .executeTakeFirst()
  return row ? Number(row.message_id) : null
}

let updateId = 1
function press(chatId: number, messageId: number, data: string) {
  return handleTelegramWebhook(deps, webhookHeaders(), {
    update_id: updateId++,
    callback_query: {
      id: `cb${updateId}`,
      from: { id: chatId, first_name: 'Анна', is_bot: false },
      data,
      message: { message_id: messageId, chat: { id: chatId, type: 'private' } },
    },
  })
}

const lastAnswer = () =>
  fake.calls.filter((c) => c.method === 'answerCallback').at(-1)

async function answerOf(eventId: string, userId: string) {
  const row = await db
    .selectFrom('app.event_attendance')
    .select('answer')
    .where('event_id', '=', eventId)
    .where('user_id', '=', userId)
    .executeTakeFirst()
  return row?.answer ?? null
}

const threeButtons = (eventId: string) => ({
  inline_keyboard: [
    [
      { text: 'Приду', callback_data: answerData(eventId, 'yes') },
      { text: '50/50', callback_data: answerData(eventId, 'maybe') },
      { text: 'Не приду', callback_data: answerData(eventId, 'no') },
    ],
  ],
})
const changeButton = (eventId: string) => ({
  inline_keyboard: [
    [{ text: 'Изменить решение', callback_data: changeData(eventId) }],
  ],
})

describe('announcements: access and recipients (TGM-11, TGM-14, Q-81, Q-83)', () => {
  it('is sent by officers and admins only', async () => {
    await linked('member')
    await rejects(broadcastRecipients(deps, GUEST), 'not_authenticated')
    for (const role of ['applicant', 'reader', 'member'] as const) {
      const actor = await actorOf(db, (await createProfiledUser(db, role)).id)
      await rejects(broadcastRecipients(deps, actor), 'forbidden')
      await rejects(sendAnnouncement(deps, actor, { body: 'x' }), 'forbidden')
    }
    for (const role of ['officer', 'admin'] as const) {
      const actor = await actorOf(db, (await createProfiledUser(db, role)).id)
      expect(await broadcastRecipients(deps, actor)).toMatchObject({ count: 1 })
    }
    const admin = await actorOf(db, (await createProfiledUser(db, 'admin')).id)
    await rejects(
      sendAnnouncement(testDeps(db), admin, { body: 'x' }),
      'telegram_unavailable',
    )
  })

  it('reaches linked members, officers and admins only', async () => {
    const member = await linked('member')
    const officer = await linked('officer')
    const admin = await linked('admin')
    const reader = await linked('reader')
    const applicant = await linked('applicant')
    const blocked = await linked('member')
    await db
      .updateTable('app.telegram_links')
      .set({ blocked_at: new Date().toISOString() })
      .where('user_id', '=', blocked.user.id)
      .execute()
    const deleting = await linked('member')
    await db
      .insertInto('app.user_deletions')
      .values({
        user_id: deleting.user.id,
        nickname: deleting.user.nickname,
        email: deleting.user.email,
        stage: 'files',
      })
      .execute()
    await createProfiledUser(db, 'member')

    expect(await broadcastRecipients(deps, admin.actor)).toMatchObject({
      count: 3,
    })
    const result = await sendAnnouncement(deps, admin.actor, {
      subject: 'Сбор',
      body: 'Сегодня в 20:00',
    })
    expect(result).toMatchObject({ recipients: 3, sent: 3, failed: 0 })
    for (const person of [member, officer, admin]) {
      expect(sentTo(person.chatId)).toEqual([
        expect.objectContaining({
          text: '<b>Сбор</b>\n\nСегодня в 20:00',
          keyboard: null,
        }),
      ])
    }
    for (const person of [reader, applicant, blocked, deleting]) {
      expect(sentTo(person.chatId)).toEqual([])
    }
  })

  it('refuses without recipients', async () => {
    const officer = await createProfiledUser(db, 'officer')
    await rejects(
      sendAnnouncement(deps, await actorOf(db, officer.id), { body: 'x' }),
      'state_conflict',
      'no_recipients',
    )
  })

  it('marks a blocked bot and counts the failure (TGM-08)', async () => {
    const member = await linked('member')
    const other = await linked('admin')
    fake.blocked.add(member.chatId)
    const result = await sendAnnouncement(deps, other.actor, { body: 'x' })
    expect(result).toMatchObject({ recipients: 2, sent: 1, failed: 1 })
    const row = await db
      .selectFrom('app.telegram_links')
      .select('blocked_at')
      .where('user_id', '=', member.user.id)
      .executeTakeFirstOrThrow()
    expect(row.blocked_at).not.toBeNull()
  })

  it('writes one audit record per sending (TGM-25, Q-85)', async () => {
    await linked('member')
    await linked('member')
    const { actor, event } = await officerWithEvent()
    await sendAnnouncement(deps, actor, { body: 'Отдельный' })
    await sendAnnouncement(deps, actor, {
      subject: 'Рейд',
      body: 'Сбор',
      eventId: event.id,
    })
    const rows = await db
      .selectFrom('app.audit_log')
      .select(['action', 'target_kind', 'target_id', 'details'])
      .where('category', '=', 'broadcast')
      .orderBy('id')
      .execute()
    expect(rows).toEqual([
      expect.objectContaining({
        action: 'broadcast_sent',
        target_kind: null,
        details: expect.objectContaining({
          event_id: null,
          recipients: 2,
          sent: 2,
          failed: 0,
          channels: ['telegram'],
        }),
      }),
      expect.objectContaining({
        action: 'broadcast_sent',
        target_kind: 'event',
        target_id: event.id,
        details: expect.objectContaining({ event_id: event.id, title: 'Рейд' }),
      }),
    ])
  })

  it('skips excluded people and audits only their unique count (BRC-16)', async () => {
    const excluded = await linked('member')
    const included = await linked('member')
    const manager = await createProfiledUser(db, 'officer')
    const result = await sendAnnouncement(deps, await actorOf(db, manager.id), {
      body: 'Сбор',
      channels: ['telegram'],
      excludedUserIds: [excluded.user.id, excluded.user.id],
    })

    expect(result).toMatchObject({ recipients: 1, sent: 1, failed: 0 })
    expect(sentTo(excluded.chatId)).toEqual([])
    expect(sentTo(included.chatId)).toHaveLength(1)
    const audit = await db
      .selectFrom('app.audit_log')
      .select('details')
      .where('action', '=', 'broadcast_sent')
      .executeTakeFirstOrThrow()
    expect(audit.details).toMatchObject({ excluded_recipients: 1 })
    expect(audit.details).not.toHaveProperty('excluded_user_ids')

    await rejects(
      sendAnnouncement(deps, await actorOf(db, manager.id), {
        body: 'Ещё раз',
        channels: ['telegram'],
        excludedUserIds: [excluded.user.id, included.user.id],
      }),
      'state_conflict',
      'excluded_no_recipients',
    )
  })
})

describe('announcements: event messages (TGM-17–TGM-24, Q-78, Q-92)', () => {
  it('sends answer buttons only to those who have not answered (Q-109)', async () => {
    const fresh = await linked('member')
    const answered = await linked('member')
    const { actor, event } = await officerWithEvent()
    await respondToEvent(deps, answered.actor, {
      eventId: event.id,
      answer: 'no',
    })
    expect(
      await broadcastRecipients(deps, actor, { eventId: event.id }),
    ).toMatchObject({
      count: 1,
      channels: { telegram: { count: 1, answered: 1 } },
    })
    expect(await broadcastRecipients(deps, actor)).toMatchObject({ count: 2 })

    const result = await sendAnnouncement(deps, actor, {
      body: 'Рейд',
      eventId: event.id,
    })
    expect(result).toMatchObject({ recipients: 1, sent: 1, failed: 0 })
    expect(sentTo(fresh.chatId)).toEqual([
      expect.objectContaining({
        text: 'Рейд',
        keyboard: threeButtons(event.id),
      }),
    ])
    expect(sentTo(answered.chatId)).toEqual([])
    expect(await activeMessageId(event.id, fresh.user.id)).not.toBeNull()
    expect(await activeMessageId(event.id, answered.user.id)).toBeNull()

    // Отдельный анонс получают все, независимо от ответов.
    await sendAnnouncement(deps, actor, { body: 'Всем' })
    expect(sentTo(answered.chatId)).toHaveLength(1)
  })

  it('keeps the previous message of one who answered and refuses when all answered (Q-109)', async () => {
    const member = await linked('member')
    const { actor, event } = await officerWithEvent()
    await sendAnnouncement(deps, actor, { body: 'Рейд', eventId: event.id })
    const first = await activeMessageId(event.id, member.user.id)
    await respondToEvent(deps, member.actor, {
      eventId: event.id,
      answer: 'yes',
    })
    const calls = fake.calls.length

    await rejects(
      sendAnnouncement(deps, actor, { body: 'Ещё раз', eventId: event.id }),
      'state_conflict',
      'all_answered',
    )
    expect(fake.calls.slice(calls)).toEqual([])
    expect(await activeMessageId(event.id, member.user.id)).toBe(first)
  })

  it('refuses a closed, started or missing event', async () => {
    await linked('member')
    const { actor, event } = await officerWithEvent()
    const later = { ...deps, now: () => new Date('2099-11-15T00:00:00Z') }
    await rejects(
      sendAnnouncement(later, actor, { body: 'x', eventId: event.id }),
      'state_conflict',
      'started',
    )
    await rejects(
      sendAnnouncement(deps, actor, {
        body: 'x',
        eventId: '00000000-0000-4000-8000-000000000000',
      }),
      'not_found',
    )
    await closeEvent(deps, actor, { id: event.id })
    await rejects(
      sendAnnouncement(deps, actor, { body: 'x', eventId: event.id }),
      'state_conflict',
      'closed',
    )
    expect(fake.calls).toEqual([])
  })

  it('strips buttons and the answer line from the previous message (Q-78)', async () => {
    const member = await linked('member')
    const { actor, event } = await officerWithEvent()
    await sendAnnouncement(deps, actor, {
      subject: 'Первый',
      body: 'Текст',
      eventId: event.id,
    })
    const first = (await activeMessageId(event.id, member.user.id))!
    await sendAnnouncement(deps, actor, { body: 'Второй', eventId: event.id })
    const second = (await activeMessageId(event.id, member.user.id))!

    expect(second).not.toBe(first)
    expect(fake.calls).toContainEqual({
      method: 'editHtml',
      chatId: member.chatId,
      messageId: first,
      text: '<b>Первый</b>\n\nТекст',
      keyboard: null,
    })
    // Первый анонс больше ни на что не ссылается и удалён.
    const announcements = await db
      .selectFrom('app.telegram_announcements')
      .select('body')
      .execute()
    expect(announcements).toEqual([{ body: 'Второй' }])
  })

  it('keeps two events in two strictly separate messages', async () => {
    const member = await linked('member')
    const { actor, event } = await officerWithEvent()
    const other = await createEvent(deps, actor, {
      ...eventFields,
      title: 'Осада',
    })
    await sendAnnouncement(deps, actor, { body: 'Рейд', eventId: event.id })
    await sendAnnouncement(deps, actor, { body: 'Осада', eventId: other.id })
    const raid = (await activeMessageId(event.id, member.user.id))!
    const siege = (await activeMessageId(other.id, member.user.id))!
    expect(raid).not.toBe(siege)
    expect(fake.calls.filter((c) => c.method === 'editHtml')).toEqual([])

    await press(member.chatId, siege, answerData(other.id, 'yes'))
    expect(await answerOf(other.id, member.user.id)).toBe('yes')
    expect(await answerOf(event.id, member.user.id)).toBeNull()
    // Кнопка чужого события на этом сообщении не принимается.
    await press(member.chatId, siege, answerData(event.id, 'no'))
    expect(lastAnswer()).toMatchObject({ text: CALLBACK_TEXTS.stale })
    expect(await answerOf(event.id, member.user.id)).toBeNull()
  })
})

describe('announcements: buttons (TGM-18–TGM-23, Q-76)', () => {
  async function announced() {
    const member = await linked('member')
    const { actor, event } = await officerWithEvent()
    await sendAnnouncement(deps, actor, { body: 'Рейд', eventId: event.id })
    const messageId = (await activeMessageId(event.id, member.user.id))!
    fake.calls.length = 0
    return { member, event, messageId, officer: actor }
  }

  it('saves an answer like the website and offers «Изменить решение»', async () => {
    const { member, event, messageId } = await announced()
    await press(member.chatId, messageId, answerData(event.id, 'maybe'))
    expect(await answerOf(event.id, member.user.id)).toBe('maybe')
    expect(fake.calls).toEqual([
      {
        method: 'editHtml',
        chatId: member.chatId,
        messageId,
        text: 'Рейд\n\n<i>Ваш ответ: 50/50</i>',
        keyboard: changeButton(event.id),
      },
      { method: 'answerCallback', callbackId: expect.any(String) },
    ])
  })

  it('shows three buttons again on «Изменить решение» without changing the answer', async () => {
    const { member, event, messageId } = await announced()
    await press(member.chatId, messageId, answerData(event.id, 'yes'))
    await press(member.chatId, messageId, changeData(event.id))
    expect(await answerOf(event.id, member.user.id)).toBe('yes')
    expect(
      fake.calls.filter((c) => c.method === 'editHtml').at(-1),
    ).toMatchObject({
      text: 'Рейд\n\n<i>Ваш ответ: Приду</i>',
      keyboard: threeButtons(event.id),
    })
    await press(member.chatId, messageId, answerData(event.id, 'no'))
    expect(await answerOf(event.id, member.user.id)).toBe('no')
  })

  it('refuses a stale message and removes its buttons', async () => {
    const { member, event, messageId } = await announced()
    await press(member.chatId, messageId - 1, answerData(event.id, 'yes'))
    expect(lastAnswer()).toMatchObject({ text: CALLBACK_TEXTS.stale })
    expect(fake.calls).toContainEqual({
      method: 'editKeyboard',
      chatId: member.chatId,
      messageId: messageId - 1,
      keyboard: null,
    })
    expect(await answerOf(event.id, member.user.id)).toBeNull()
  })

  it('refuses an unlinked Telegram and a reader', async () => {
    const { member, event, messageId } = await announced()
    await press(999_999, messageId, answerData(event.id, 'yes'))
    expect(lastAnswer()).toMatchObject({ text: CALLBACK_TEXTS.notLinked })

    await db
      .updateTable('app.profiles')
      .set({ access_role: 'reader' })
      .where('id', '=', member.user.id)
      .execute()
    await press(member.chatId, messageId, answerData(event.id, 'yes'))
    expect(lastAnswer()).toMatchObject({ text: CALLBACK_TEXTS.forbidden })
    expect(await answerOf(event.id, member.user.id)).toBeNull()
  })

  it('refuses after the start, after closing and after deletion', async () => {
    const { member, event, messageId, officer } = await announced()
    const later = { ...deps, now: () => new Date('2099-11-15T00:00:00Z') }
    await handleTelegramWebhook(later, webhookHeaders(), {
      update_id: updateId++,
      callback_query: {
        id: 'late',
        from: { id: member.chatId, first_name: 'Анна' },
        data: answerData(event.id, 'yes'),
        message: {
          message_id: messageId,
          chat: { id: member.chatId, type: 'private' },
        },
      },
    })
    expect(lastAnswer()).toMatchObject({ text: CALLBACK_TEXTS.started })
    expect(fake.calls).toContainEqual(
      expect.objectContaining({ method: 'editKeyboard', keyboard: null }),
    )

    await closeEvent(deps, officer, { id: event.id })
    await press(member.chatId, messageId, answerData(event.id, 'yes'))
    expect(lastAnswer()).toMatchObject({ text: CALLBACK_TEXTS.closed })

    const second = await createEvent(deps, officer, eventFields)
    await sendAnnouncement(deps, officer, { body: 'x', eventId: second.id })
    const secondMessage = (await activeMessageId(second.id, member.user.id))!
    await deleteEvent(deps, officer, { id: second.id })
    await press(member.chatId, secondMessage, answerData(second.id, 'yes'))
    expect(lastAnswer()).toMatchObject({ text: CALLBACK_TEXTS.deleted })
    expect(await answerOf(event.id, member.user.id)).toBeNull()
  })

  it('ignores malformed button data', async () => {
    const { member, messageId } = await announced()
    await press(member.chatId, messageId, 'a:oops')
    expect(lastAnswer()).toMatchObject({ text: CALLBACK_TEXTS.stale })
  })
})

describe('announcements: website answers (TGM-21, Q-77)', () => {
  it('updates the active Telegram message after an answer on the site', async () => {
    const member = await linked('member')
    const { actor, event } = await officerWithEvent()
    await sendAnnouncement(deps, actor, { body: 'Рейд', eventId: event.id })
    const messageId = (await activeMessageId(event.id, member.user.id))!
    fake.calls.length = 0
    await respondToEvent(deps, member.actor, {
      eventId: event.id,
      answer: 'yes',
    })
    expect(fake.calls).toEqual([
      {
        method: 'editHtml',
        chatId: member.chatId,
        messageId,
        text: 'Рейд\n\n<i>Ваш ответ: Приду</i>',
        keyboard: changeButton(event.id),
      },
    ])
  })

  it('keeps the website answer when Telegram fails', async () => {
    const member = await linked('member')
    const { actor, event } = await officerWithEvent()
    await sendAnnouncement(deps, actor, { body: 'Рейд', eventId: event.id })
    fake.telegram.gateway.editHtml = async () => {
      throw new Error('сеть недоступна')
    }
    const summary = await respondToEvent(deps, member.actor, {
      eventId: event.id,
      answer: 'maybe',
    })
    expect(summary).toMatchObject({ myAnswer: 'maybe' })
    expect(await answerOf(event.id, member.user.id)).toBe('maybe')
  })

  it('does nothing without an announcement or without Telegram', async () => {
    const member = await linked('member')
    const { event } = await officerWithEvent()
    await respondToEvent(deps, member.actor, {
      eventId: event.id,
      answer: 'yes',
    })
    await respondToEvent(testDeps(db), member.actor, {
      eventId: event.id,
      answer: 'no',
    })
    expect(fake.calls).toEqual([])
  })
})

describe('vote announcements (TGM-30, VOT-17)', () => {
  async function sendVoteAnnouncement(
    vote: Awaited<ReturnType<typeof createVote>>,
    imageUrl: string | null = null,
  ) {
    return deliverAnnouncement(
      deps,
      fake.telegram,
      { subject: 'Маршрут', body: 'Выберите вариант кнопкой или на сайте.' },
      null,
      null,
      [],
      imageUrl,
      vote.id,
      vote.options,
    )
  }

  it('sends buttons to linked members, including people who already voted', async () => {
    const member = await linked('member')
    const officer = await linked('officer')
    const { actor: voteOwner } = await officerWithEvent()
    const vote = await createVote(deps, voteOwner, {
      title: 'Маршрут',
      context: '',
      options: ['За', 'Большинство участников выберет этот путь'],
    })
    await castBallot({ ...deps, telegram: null }, member.actor, {
      voteId: vote.id,
      optionId: vote.options[0]!.id,
    })

    const result = await sendVoteAnnouncement(vote)

    expect(result).toEqual({ recipients: 2, sent: 2, failed: 0 })
    for (const person of [member, officer]) {
      expect(await activeVoteMessageId(vote.id, person.user.id)).not.toBeNull()
    }
    const calls = fake.calls.filter((call) => call.method === 'sendHtml')
    expect(calls).toHaveLength(2)
    const votedMessage = calls.find((call) => call.chatId === member.chatId)!
    const openMessage = calls.find((call) => call.chatId === officer.chatId)!
    expect(openMessage.text).toContain(
      '2. Большинство участников выберет этот путь',
    )
    expect(
      openMessage.keyboard?.inline_keyboard.flat().map((button) => button.text),
    ).toEqual(['За', expect.stringMatching(/^2\. Большин/)])
    expect(votedMessage.text).toContain('Ваш голос: За')
    expect(
      votedMessage.keyboard?.inline_keyboard
        .flat()
        .map((button) => button.text),
    ).toEqual(['Изменить решение'])
  })

  it('saves and changes a ballot from the latest Telegram message', async () => {
    const member = await linked('member')
    const { actor: voteOwner } = await officerWithEvent()
    const vote = await createVote(deps, voteOwner, {
      title: 'Маршрут',
      context: '',
      options: ['За', 'Против'],
    })
    await sendVoteAnnouncement(vote)
    const messageId = await activeVoteMessageId(vote.id, member.user.id)

    await press(member.chatId, messageId!, voteAnswerData(vote.options[0]!.id))
    expect(lastAnswer()?.text).toBeUndefined()
    expect(fake.calls.at(-2)).toMatchObject({
      method: 'editHtml',
      text: expect.stringContaining('Ваш голос: За'),
      keyboard: {
        inline_keyboard: [[{ text: 'Изменить решение', callback_data: 'vc' }]],
      },
    })

    await press(member.chatId, messageId!, voteChangeData())
    expect(fake.calls.at(-2)?.text).toContain('Ваш голос: За')
    expect(fake.calls.at(-2)?.keyboard?.inline_keyboard.flat()).toHaveLength(2)
    await press(member.chatId, messageId!, voteAnswerData(vote.options[1]!.id))

    const ballot = await db
      .selectFrom('app.vote_ballots')
      .select('option_id')
      .where('vote_id', '=', vote.id)
      .where('voter_id', '=', member.user.id)
      .executeTakeFirstOrThrow()
    expect(ballot.option_id).toBe(vote.options[1]!.id)
  })

  it('rejects an old button after the vote is broadcast again', async () => {
    const member = await linked('member')
    const { actor: voteOwner } = await officerWithEvent()
    const vote = await createVote(deps, voteOwner, {
      title: 'Маршрут',
      context: '',
      options: ['За', 'Против'],
    })
    await sendVoteAnnouncement(vote)
    const oldMessageId = await activeVoteMessageId(vote.id, member.user.id)
    await sendVoteAnnouncement(vote)

    await press(
      member.chatId,
      oldMessageId!,
      voteAnswerData(vote.options[0]!.id),
    )

    expect(lastAnswer()?.text).toBe(CALLBACK_TEXTS.voteStale)
    const ballots = await db
      .selectFrom('app.vote_ballots')
      .select('id')
      .where('vote_id', '=', vote.id)
      .execute()
    expect(ballots).toEqual([])
    expect(fake.calls).toContainEqual({
      method: 'editKeyboard',
      chatId: member.chatId,
      messageId: oldMessageId,
      keyboard: null,
    })
  })

  it('does not save an old button press that overlaps a replacement broadcast', async () => {
    const member = await linked('member')
    const { actor: voteOwner } = await officerWithEvent()
    const vote = await createVote(deps, voteOwner, {
      title: 'Маршрут',
      context: '',
      options: ['За', 'Против'],
    })
    await sendVoteAnnouncement(vote)
    const oldMessageId = (await activeVoteMessageId(vote.id, member.user.id))!
    const original = telegramRepository.activeVoteMessageByTarget
    let signalLoaded!: () => void
    let releaseLookup!: () => void
    const loaded = new Promise<void>((resolve) => {
      signalLoaded = resolve
    })
    const gate = new Promise<void>((resolve) => {
      releaseLookup = resolve
    })
    telegramRepository.activeVoteMessageByTarget = async (
      executor,
      chatId,
      messageId,
    ) => {
      const message = await original(executor, chatId, messageId)
      if (messageId === oldMessageId) {
        signalLoaded()
        await gate
      }
      return message
    }

    try {
      const oldPress = press(
        member.chatId,
        oldMessageId,
        voteAnswerData(vote.options[0]!.id),
      )
      await loaded
      await sendVoteAnnouncement(vote)
      releaseLookup()
      await oldPress
    } finally {
      releaseLookup()
      telegramRepository.activeVoteMessageByTarget = original
    }

    expect(lastAnswer()?.text).toBe(CALLBACK_TEXTS.voteStale)
    expect(
      await db
        .selectFrom('app.vote_ballots')
        .select('id')
        .where('vote_id', '=', vote.id)
        .execute(),
    ).toEqual([])
  })

  it('reconciles a ballot cast while the Telegram message is being sent', async () => {
    const member = await linked('member')
    const { actor: voteOwner } = await officerWithEvent()
    const vote = await createVote(deps, voteOwner, {
      title: 'Маршрут',
      context: '',
      options: ['За', 'Против'],
    })
    let signalSend!: () => void
    let releaseSend!: () => void
    const started = new Promise<void>((resolve) => {
      signalSend = resolve
    })
    const gate = new Promise<void>((resolve) => {
      releaseSend = resolve
    })
    fake.controls.beforeSendHtml = async () => {
      signalSend()
      await gate
    }

    const pendingBroadcast = sendVoteAnnouncement(vote)
    await started
    await castBallot(deps, member.actor, {
      voteId: vote.id,
      optionId: vote.options[1]!.id,
    })
    releaseSend()
    await pendingBroadcast

    expect(fake.calls).toContainEqual(
      expect.objectContaining({
        method: 'editHtml',
        text: expect.stringContaining('Ваш голос: Против'),
      }),
    )
  })

  it('counts a replaced message with no saved button record as failed only', async () => {
    await linked('member')
    const { actor: voteOwner } = await officerWithEvent()
    const vote = await createVote(deps, voteOwner, {
      title: 'Маршрут',
      context: '',
      options: ['За', 'Против'],
    })
    let signalSend!: () => void
    let releaseSend!: () => void
    const started = new Promise<void>((resolve) => {
      signalSend = resolve
    })
    const gate = new Promise<void>((resolve) => {
      releaseSend = resolve
    })
    fake.controls.beforeSendHtml = async () => {
      fake.controls.beforeSendHtml = null
      signalSend()
      await gate
    }

    const replacedBroadcast = sendVoteAnnouncement(vote)
    await started
    const currentBroadcast = await sendVoteAnnouncement(vote)
    releaseSend()
    const replacedResult = await replacedBroadcast

    expect(currentBroadcast).toMatchObject({ sent: 1, failed: 0 })
    expect(replacedResult).toMatchObject({ sent: 0, failed: 1 })
  })

  it('rechecks the latest choice when two Telegram message edits overlap', async () => {
    const member = await linked('member')
    const { actor: voteOwner } = await officerWithEvent()
    const vote = await createVote(deps, voteOwner, {
      title: 'Маршрут',
      context: '',
      options: ['За', 'Против'],
    })
    await sendVoteAnnouncement(vote)
    fake.controls.beforeEditHtml = async () => {
      fake.controls.beforeEditHtml = null
      await castBallot(
        { ...deps, telegram: null, max: null, vk: null },
        member.actor,
        { voteId: vote.id, optionId: vote.options[0]!.id },
      )
    }

    await castBallot(deps, member.actor, {
      voteId: vote.id,
      optionId: vote.options[1]!.id,
    })

    expect(fake.calls.at(-1)).toMatchObject({
      method: 'editHtml',
      text: expect.stringContaining('Ваш голос: За'),
    })
    expect(
      await db
        .selectFrom('app.vote_ballots')
        .select('option_id')
        .where('vote_id', '=', vote.id)
        .where('voter_id', '=', member.user.id)
        .executeTakeFirstOrThrow(),
    ).toMatchObject({ option_id: vote.options[0]!.id })
  })

  it('stops syncing private vote choices to a Telegram account after unlinking', async () => {
    const member = await linked('member')
    const { actor: voteOwner } = await officerWithEvent()
    const vote = await createVote(deps, voteOwner, {
      title: 'Маршрут',
      context: '',
      options: ['За', 'Против'],
    })
    await sendVoteAnnouncement(vote)
    const sentCalls = fake.calls.length

    await unlinkTelegram(deps, member.actor)
    await castBallot(deps, member.actor, {
      voteId: vote.id,
      optionId: vote.options[1]!.id,
    })

    expect(fake.calls.slice(sentCalls)).not.toContainEqual(
      expect.objectContaining({ method: 'editHtml' }),
    )
    expect(
      await db
        .selectFrom('app.telegram_vote_messages')
        .select('vote_id')
        .where('user_id', '=', member.user.id)
        .execute(),
    ).toEqual([])
  })

  it('removes the buttons when a member loses access or the vote closes', async () => {
    const member = await linked('member')
    const { actor: voteOwner } = await officerWithEvent()
    const vote = await createVote(deps, voteOwner, {
      title: 'Маршрут',
      context: '',
      options: ['За', 'Против'],
    })
    await sendVoteAnnouncement(vote)
    const messageId = await activeVoteMessageId(vote.id, member.user.id)

    await db
      .updateTable('app.profiles')
      .set({ access_role: 'reader' })
      .where('id', '=', member.user.id)
      .execute()
    await press(member.chatId, messageId!, voteAnswerData(vote.options[0]!.id))
    expect(lastAnswer()?.text).toBe(CALLBACK_TEXTS.forbidden)

    await db
      .updateTable('app.profiles')
      .set({ access_role: 'member' })
      .where('id', '=', member.user.id)
      .execute()
    await closeVote(deps, voteOwner, { id: vote.id })
    await press(member.chatId, messageId!, voteAnswerData(vote.options[0]!.id))
    expect(lastAnswer()?.text).toBe(CALLBACK_TEXTS.voteClosed)
    expect(
      fake.calls.filter((call) => call.method === 'editKeyboard'),
    ).toHaveLength(2)
    expect(
      await db
        .selectFrom('app.vote_ballots')
        .select('id')
        .where('vote_id', '=', vote.id)
        .execute(),
    ).toEqual([])
  })

  it('keeps buttons on the text message when a long photo announcement is split', async () => {
    const member = await linked('member')
    const { actor: voteOwner } = await officerWithEvent()
    const vote = await createVote(deps, voteOwner, {
      title: 'Маршрут',
      context: '',
      options: ['За', 'Против'],
    })
    const imageUrl = 'https://murr.test/messenger/vote.jpg'
    const result = await deliverAnnouncement(
      deps,
      fake.telegram,
      { subject: 'Маршрут', body: 'Текст. '.repeat(150) },
      null,
      null,
      [],
      imageUrl,
      vote.id,
      vote.options,
    )

    expect(result.sent).toBe(1)
    expect(fake.calls[0]).toMatchObject({
      method: 'sendPhoto',
      photo: imageUrl,
    })
    expect(fake.calls[1]).toMatchObject({
      method: 'sendHtml',
      chatId: member.chatId,
      keyboard: {
        inline_keyboard: expect.arrayContaining([
          expect.arrayContaining([
            expect.objectContaining({
              callback_data: voteAnswerData(vote.options[0]!.id),
            }),
          ]),
        ]),
      },
    })
    expect(await activeVoteMessageId(vote.id, member.user.id)).toBeTruthy()
  })

  it('splits a photo when the full vote options exceed the caption limit', async () => {
    const member = await linked('member')
    const { actor: voteOwner } = await officerWithEvent()
    const options = Array.from(
      { length: 10 },
      (_, index) => `Вариант ${index + 1} ${'маршрутный '.repeat(6)}`,
    )
    const vote = await createVote(deps, voteOwner, {
      title: 'Маршрут',
      context: '',
      options,
    })
    const imageUrl = 'https://murr.test/messenger/long-options.jpg'

    await deliverAnnouncement(
      deps,
      fake.telegram,
      {
        subject: 'Маршрут '.repeat(12),
        body: 'Детали маршрута. '.repeat(9),
      },
      null,
      null,
      [],
      imageUrl,
      vote.id,
      vote.options,
    )

    expect(fake.calls[0]).toMatchObject({
      method: 'sendPhoto',
      photo: imageUrl,
    })
    expect(fake.calls[1]).toMatchObject({
      method: 'sendHtml',
      chatId: member.chatId,
      keyboard: expect.any(Object),
    })
  })

  it('keeps the vote buttons when Telegram cannot send the image', async () => {
    const member = await linked('member')
    const { actor: voteOwner } = await officerWithEvent()
    const vote = await createVote(deps, voteOwner, {
      title: 'Маршрут',
      context: '',
      options: ['За', 'Против'],
    })
    const imageUrl = 'https://murr.test/messenger/missing-vote.jpg'
    fake.failingPhotos.add(imageUrl)

    const result = await deliverAnnouncement(
      deps,
      fake.telegram,
      { subject: 'Маршрут', body: 'Выберите направление.' },
      null,
      null,
      [],
      imageUrl,
      vote.id,
      vote.options,
    )

    expect(result).toMatchObject({ sent: 1, failed: 0 })
    expect(fake.calls[0]).toMatchObject({ method: 'sendHtml', photo: imageUrl })
    expect(fake.calls[1]).toMatchObject({
      method: 'sendHtml',
      chatId: member.chatId,
      keyboard: expect.any(Object),
    })
    expect(await activeVoteMessageId(vote.id, member.user.id)).toBeTruthy()
  })

  it('rejects a button option belonging to another vote', async () => {
    const member = await linked('member')
    const { actor: voteOwner } = await officerWithEvent()
    const vote = await createVote(deps, voteOwner, {
      title: 'Маршрут',
      context: '',
      options: ['За', 'Против'],
    })
    const otherVote = await createVote(deps, voteOwner, {
      title: 'Время',
      context: '',
      options: ['Утром', 'Вечером'],
    })
    await sendVoteAnnouncement(vote)
    const messageId = await activeVoteMessageId(vote.id, member.user.id)

    await press(
      member.chatId,
      messageId!,
      voteAnswerData(otherVote.options[0]!.id),
    )

    expect(lastAnswer()?.text).toBe(CALLBACK_TEXTS.voteStale)
    expect(
      await db
        .selectFrom('app.vote_ballots')
        .select('id')
        .where('vote_id', '=', vote.id)
        .execute(),
    ).toEqual([])
  })

  it('updates the active Telegram message after a website vote', async () => {
    const member = await linked('member')
    const { actor: voteOwner } = await officerWithEvent()
    const vote = await createVote(deps, voteOwner, {
      title: 'Маршрут',
      context: '',
      options: ['За', 'Против'],
    })
    await sendVoteAnnouncement(vote)

    await castBallot(deps, member.actor, {
      voteId: vote.id,
      optionId: vote.options[1]!.id,
    })

    expect(fake.calls.at(-1)).toMatchObject({
      method: 'editHtml',
      text: expect.stringContaining('Ваш голос: Против'),
      keyboard: {
        inline_keyboard: [[{ text: 'Изменить решение', callback_data: 'vc' }]],
      },
    })
  })
})
