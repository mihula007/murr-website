import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppDeps } from '../../supabase/functions/_shared/app.ts'
import { GUEST } from '../../supabase/functions/_shared/auth/actor.ts'
import {
  sendAnnouncement,
  telegramRecipients,
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
} from '../../supabase/functions/_shared/telegram/callback-data.ts'
import { CALLBACK_TEXTS } from '../../supabase/functions/_shared/telegram/messages.ts'
import { handleTelegramWebhook } from '../../supabase/functions/_shared/telegram/service.ts'
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
    await rejects(telegramRecipients(deps, GUEST), 'not_authenticated')
    for (const role of ['applicant', 'reader', 'member'] as const) {
      const actor = await actorOf(db, (await createProfiledUser(db, role)).id)
      await rejects(telegramRecipients(deps, actor), 'forbidden')
      await rejects(sendAnnouncement(deps, actor, { body: 'x' }), 'forbidden')
    }
    for (const role of ['officer', 'admin'] as const) {
      const actor = await actorOf(db, (await createProfiledUser(db, role)).id)
      expect(await telegramRecipients(deps, actor)).toEqual({ count: 1 })
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

    expect(await telegramRecipients(deps, admin.actor)).toEqual({ count: 3 })
    const result = await sendAnnouncement(deps, admin.actor, {
      subject: 'Сбор',
      body: 'Сегодня в 20:00',
    })
    expect(result).toEqual({ recipients: 3, sent: 3, failed: 0 })
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
    expect(result).toEqual({ recipients: 2, sent: 1, failed: 1 })
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
})

describe('announcements: event messages (TGM-17–TGM-24, Q-78, Q-92)', () => {
  it('sends answer buttons, or «Изменить решение» to those who answered', async () => {
    const fresh = await linked('member')
    const answered = await linked('member')
    const { actor, event } = await officerWithEvent()
    await respondToEvent(deps, answered.actor, {
      eventId: event.id,
      answer: 'no',
    })
    await sendAnnouncement(deps, actor, { body: 'Рейд', eventId: event.id })

    expect(sentTo(fresh.chatId)).toEqual([
      expect.objectContaining({
        text: 'Рейд',
        keyboard: threeButtons(event.id),
      }),
    ])
    expect(sentTo(answered.chatId)).toEqual([
      expect.objectContaining({
        text: 'Рейд\n\n<i>Ваш ответ: Не приду</i>',
        keyboard: changeButton(event.id),
      }),
    ])
    expect(await activeMessageId(event.id, fresh.user.id)).not.toBeNull()
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
