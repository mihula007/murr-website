import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppDeps } from '../../supabase/functions/_shared/app.ts'
import { GUEST } from '../../supabase/functions/_shared/auth/actor.ts'
import {
  broadcastRecipients,
  sendAnnouncement,
} from '../../supabase/functions/_shared/broadcasts/service.ts'
import type { AccessRole } from '../../supabase/functions/_shared/contracts/account.ts'
import {
  closeEvent,
  createEvent,
  respondToEvent,
} from '../../supabase/functions/_shared/events/service.ts'
import {
  createGroup,
  deleteGroup,
  moveMember,
} from '../../supabase/functions/_shared/groups/service.ts'
import {
  MAX_BOT_TEXTS,
  MAX_CALLBACK_TEXTS,
} from '../../supabase/functions/_shared/max/messages.ts'
import { deliverMaxAnnouncement } from '../../supabase/functions/_shared/max/announcements.ts'
import {
  handleMaxWebhook,
  maxStatus,
  startMaxLink,
  unlinkMax,
} from '../../supabase/functions/_shared/max/service.ts'
import {
  answerData,
  changeData,
  voteAnswerData,
  voteChangeData,
} from '../../supabase/functions/_shared/messenger/callback-data.ts'
import {
  castBallot,
  closeVote,
  createVote,
} from '../../supabase/functions/_shared/votes/service.ts'
import { handleTelegramWebhook } from '../../supabase/functions/_shared/telegram/service.ts'
import {
  actorOf,
  createProfiledUser,
  fakeMax,
  fakeTelegram,
  maxWebhookHeaders,
  resetAppData,
  testDb,
  testDeps,
  webhookHeaders,
} from './support.ts'

const db = testDb()
let fake: ReturnType<typeof fakeMax>
let tg: ReturnType<typeof fakeTelegram>
let deps: AppDeps

beforeEach(async () => {
  await resetAppData(db)
  fake = fakeMax()
  tg = fakeTelegram()
  deps = { ...testDeps(db), max: fake.max, telegram: tg.telegram }
})
afterAll(() => db.destroy())

const rejects = (promise: Promise<unknown>, code: string, reason?: string) =>
  expect(promise).rejects.toMatchObject({
    code,
    ...(reason ? { fields: { reason } } : {}),
  })

async function roleActor(role: AccessRole) {
  const user = await createProfiledUser(db, role)
  return { user, actor: await actorOf(db, user.id) }
}

const hook = (update: unknown, d: AppDeps = deps) =>
  handleMaxWebhook(d, maxWebhookHeaders(), update)

const maxUser = (id: number, extra: Record<string, unknown> = {}) => ({
  user_id: id,
  first_name: 'Анна',
  is_bot: false,
  ...extra,
})

const started = (id: number, payload?: string, extra = {}) => ({
  update_type: 'bot_started',
  timestamp: Date.now(),
  chat_id: id + 1_000_000,
  user: maxUser(id, extra),
  ...(payload ? { payload } : {}),
})

async function linkCode(actor: Awaited<ReturnType<typeof actorOf>>) {
  const { url } = await startMaxLink(deps, actor)
  return new URL(url).searchParams.get('start')!
}

const replies = () =>
  fake.calls.filter((c) => c.method === 'sendText').map((c) => c.text)

let maxCounter = 50_000

/** Участник с привязанным MAX (фикстура в обход вебхука). */
async function linked(role: AccessRole, telegram = false) {
  const user = await createProfiledUser(db, role)
  const maxUserId = maxCounter++
  await db
    .insertInto('app.max_links')
    .values({
      user_id: user.id,
      max_user_id: maxUserId,
      chat_id: maxUserId + 1_000_000,
      display_name: user.nickname,
    })
    .execute()
  if (telegram) {
    await db
      .insertInto('app.telegram_links')
      .values({
        user_id: user.id,
        telegram_user_id: maxUserId,
        chat_id: maxUserId,
        display_name: user.nickname,
      })
      .execute()
  }
  return { user, maxUserId, actor: await actorOf(db, user.id) }
}

const eventFields = {
  title: 'Рейд',
  type: 'pve',
  date: '2099-11-14',
  time: '20:00',
  description: 'Собираемся у портала',
}

async function officerWithEvent() {
  const { actor } = await roleActor('officer')
  const event = await createEvent(deps, actor, eventFields)
  return { actor, event }
}

const sentTo = (userId: number) =>
  fake.calls.filter((c) => c.method === 'sendHtml' && c.userId === userId)

async function activeMid(eventId: string, userId: string) {
  const row = await db
    .selectFrom('app.max_event_messages')
    .select('message_id')
    .where('event_id', '=', eventId)
    .where('user_id', '=', userId)
    .executeTakeFirst()
  return row?.message_id ?? null
}

async function activeVoteMid(voteId: string, userId: string) {
  const row = await db
    .selectFrom('app.max_vote_messages')
    .select('message_id')
    .where('vote_id', '=', voteId)
    .where('user_id', '=', userId)
    .executeTakeFirst()
  return row?.message_id ?? null
}

let callbackCounter = 1
function press(maxUserId: number, mid: string, payload: string) {
  return hook({
    update_type: 'message_callback',
    timestamp: Date.now(),
    callback: {
      timestamp: Date.now(),
      callback_id: `cb${callbackCounter++}`,
      payload,
      user: maxUser(maxUserId),
    },
    message: {
      recipient: { chat_id: maxUserId + 1_000_000, chat_type: 'dialog' },
      body: { mid, seq: 1, text: 'Рейд' },
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

const threeButtons = (eventId: string) => [
  [
    { type: 'callback', text: 'Приду', payload: answerData(eventId, 'yes') },
    { type: 'callback', text: '50/50', payload: answerData(eventId, 'maybe') },
    { type: 'callback', text: 'Не приду', payload: answerData(eventId, 'no') },
  ],
]
const changeButton = (eventId: string) => [
  [
    {
      type: 'callback',
      text: 'Изменить решение',
      payload: changeData(eventId),
    },
  ],
]

describe('max: access (MAX-01)', () => {
  it('is open to member, officer and admin only', async () => {
    await rejects(maxStatus(deps, GUEST), 'not_authenticated')
    for (const role of ['applicant', 'reader'] as const) {
      const { actor } = await roleActor(role)
      await rejects(maxStatus(deps, actor), 'forbidden')
      await rejects(startMaxLink(deps, actor), 'forbidden')
      await rejects(unlinkMax(deps, actor), 'forbidden')
    }
    for (const role of ['member', 'officer', 'admin'] as const) {
      const { actor } = await roleActor(role)
      expect(await maxStatus(deps, actor)).toEqual({
        configured: true,
        linked: false,
        username: null,
        displayName: null,
        blocked: false,
      })
    }
  })

  it('reports a server without a bot', async () => {
    const { actor } = await roleActor('member')
    const bare = testDeps(db)
    expect(await maxStatus(bare, actor)).toMatchObject({ configured: false })
    await rejects(startMaxLink(bare, actor), 'max_unavailable')
    await rejects(hook(started(1), bare), 'not_found')
  })
})

describe('max: linking (MAX-01, MAX-02)', () => {
  it('links by a one-time code from bot_started and stores only its hash', async () => {
    const { user, actor } = await roleActor('member')
    const { url } = await startMaxLink(deps, actor)
    const code = new URL(url).searchParams.get('start')!
    expect(url.startsWith('https://max.ru/murr_test_max_bot?start=')).toBe(true)
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const stored = await db
      .selectFrom('app.max_link_codes')
      .select('code_hash')
      .executeTakeFirstOrThrow()
    expect(stored.code_hash).toMatch(/^[0-9a-f]{64}$/)

    await hook(started(7001, code, { username: 'anna' }))
    expect(replies()).toEqual([MAX_BOT_TEXTS.linked(user.nickname)])
    expect(fake.calls.at(-1)).toMatchObject({ userId: 7001 })
    expect(await maxStatus(deps, actor)).toEqual({
      configured: true,
      linked: true,
      username: 'anna',
      displayName: 'Анна',
      blocked: false,
    })
  })

  it('rejects a used code and a MAX taken by another account', async () => {
    const first = await roleActor('member')
    const second = await roleActor('member')
    const code = await linkCode(first.actor)
    await hook(started(7002, code))
    await hook(started(7003, code))
    expect(replies().at(-1)).toBe(MAX_BOT_TEXTS.linkInvalid)

    await hook(started(7002, await linkCode(second.actor)))
    expect(replies().at(-1)).toBe(MAX_BOT_TEXTS.linkTaken)
    expect(await maxStatus(deps, second.actor)).toMatchObject({
      linked: false,
    })
  })

  it('keeps MAX and Telegram independent (MAX-02)', async () => {
    const { actor } = await roleActor('member')
    await hook(started(7004, await linkCode(actor)))
    await unlinkMax(deps, actor)
    expect(await maxStatus(deps, actor)).toMatchObject({ linked: false })
    const { url } = await startMaxLink(deps, actor)
    expect(url).toContain('max.ru')
    const tgCodes = await db
      .selectFrom('app.telegram_link_codes')
      .select('user_id')
      .execute()
    expect(tgCodes).toEqual([])
  })
})

describe('max: webhook (MAX-03, TGM-09)', () => {
  it('rejects a missing or wrong secret', async () => {
    await rejects(
      handleMaxWebhook(deps, maxWebhookHeaders(null), started(1)),
      'not_found',
    )
    await rejects(
      handleMaxWebhook(deps, maxWebhookHeaders('wrong-secret'), started(1)),
      'not_found',
    )
  })

  it('ignores malformed and foreign updates', async () => {
    expect(await hook({ update_type: 'chat_title_changed' })).toEqual({})
    expect(await hook({ nonsense: true })).toEqual({})
    await hook({
      update_type: 'message_created',
      timestamp: 1,
      message: {
        sender: maxUser(7010),
        recipient: { chat_id: -1, chat_type: 'chat' },
        body: { mid: 'mid.x', seq: 1, text: 'привет' },
      },
    })
    expect(fake.calls).toEqual([])
  })

  it('explains the bot to a stranger and names the linked nickname', async () => {
    await hook(started(7011))
    expect(replies()).toEqual([MAX_BOT_TEXTS.helpGuest('https://murr.test/')])
    const { user, actor } = await roleActor('member')
    await hook(started(7012, await linkCode(actor)))
    await hook({
      update_type: 'message_created',
      timestamp: 1,
      message: {
        sender: maxUser(7012),
        recipient: { chat_id: 1_007_012, chat_type: 'dialog' },
        body: { mid: 'mid.y', seq: 1, text: '/start' },
      },
    })
    expect(replies().at(-1)).toBe(MAX_BOT_TEXTS.helpLinked(user.nickname))
  })

  it('marks a stopped bot and clears the mark on restart', async () => {
    const { actor } = await roleActor('member')
    await hook(started(7013, await linkCode(actor)))
    await hook({
      update_type: 'bot_stopped',
      timestamp: 1,
      chat_id: 1_007_013,
      user: maxUser(7013),
    })
    expect(await maxStatus(deps, actor)).toMatchObject({ blocked: true })
    await hook(started(7013))
    expect(await maxStatus(deps, actor)).toMatchObject({ blocked: false })
  })
})

describe('max: announcements (MAX-05, MAX-06, MAX-09, MAX-10, MAX-12)', () => {
  it('counts recipients per channel', async () => {
    await linked('member', true)
    await linked('member')
    await linked('reader')
    const { actor } = await roleActor('officer')
    expect(await broadcastRecipients(deps, actor)).toMatchObject({
      count: 1,
      channels: {
        telegram: { configured: true, count: 1 },
        vk: { configured: false, count: 0 },
        max: { configured: true, count: 2 },
      },
    })
    expect(await broadcastRecipients(testDeps(db), actor)).toMatchObject({
      channels: {
        telegram: { configured: false },
        max: { configured: false },
      },
    })
  })

  it('sends to the chosen channels only, with per-channel results', async () => {
    const both = await linked('member', true)
    const onlyMax = await linked('officer')
    const { actor } = await roleActor('admin')

    const maxOnly = await sendAnnouncement(deps, actor, {
      subject: 'Сбор',
      body: 'Сегодня <в 20:00>',
      channels: ['max'],
    })
    expect(maxOnly).toEqual({
      recipients: 2,
      sent: 2,
      failed: 0,
      channels: { max: { recipients: 2, sent: 2, failed: 0 } },
    })
    expect(sentTo(both.maxUserId)).toEqual([
      expect.objectContaining({
        text: '<b>Сбор</b>\n\nСегодня &lt;в 20:00&gt;',
        keyboard: null,
      }),
    ])
    expect(sentTo(onlyMax.maxUserId)).toHaveLength(1)
    expect(tg.calls).toEqual([])

    const result = await sendAnnouncement(deps, actor, {
      body: 'Оба',
      channels: ['telegram', 'max'],
    })
    expect(result).toEqual({
      recipients: 3,
      sent: 3,
      failed: 0,
      channels: {
        telegram: { recipients: 1, sent: 1, failed: 0 },
        max: { recipients: 2, sent: 2, failed: 0 },
      },
    })
    const audit = await db
      .selectFrom('app.audit_log')
      .select(['summary', 'details'])
      .where('action', '=', 'broadcast_sent')
      .orderBy('id')
      .execute()
    expect(audit).toEqual([
      {
        summary: 'Отправка анонса в MAX',
        details: expect.objectContaining({
          channels: ['max'],
          max_sent: 2,
          max_failed: 0,
        }),
      },
      {
        summary: 'Отправка анонса в Telegram и MAX',
        details: expect.objectContaining({
          channels: ['telegram', 'max'],
          recipients: 3,
          telegram_sent: 1,
          max_sent: 2,
        }),
      },
    ])
  })

  it('does not deliver MAX messages to excluded profiles (BRC-16)', async () => {
    const excluded = await linked('member')
    const included = await linked('officer')
    const { actor } = await roleActor('admin')
    const result = await sendAnnouncement(deps, actor, {
      body: 'Сбор',
      channels: ['max'],
      excludedUserIds: [excluded.user.id],
    })

    expect(result.channels).toEqual({
      max: { recipients: 1, sent: 1, failed: 0 },
    })
    expect(sentTo(excluded.maxUserId)).toEqual([])
    expect(sentTo(included.maxUserId)).toHaveLength(1)
  })

  it('skips an empty channel, refuses when all are empty or unconfigured', async () => {
    const { actor } = await roleActor('officer')
    await rejects(
      sendAnnouncement(deps, actor, { body: 'x', channels: ['max'] }),
      'state_conflict',
      'no_recipients',
    )
    await linked('member')
    const result = await sendAnnouncement(deps, actor, {
      body: 'x',
      channels: ['telegram', 'max'],
    })
    expect(result.channels).toEqual({
      telegram: { recipients: 0, sent: 0, failed: 0 },
      max: { recipients: 1, sent: 1, failed: 0 },
    })
    await rejects(
      sendAnnouncement({ ...deps, max: null }, actor, {
        body: 'x',
        channels: ['max'],
      }),
      'max_unavailable',
    )
    await rejects(
      sendAnnouncement(deps, actor, { body: 'x', channels: ['whatsapp'] }),
      'validation_failed',
    )
  })

  it('marks a stopped bot on a failed send (MAX-03)', async () => {
    const member = await linked('member')
    await linked('admin')
    fake.blocked.add(member.maxUserId)
    const { actor } = await roleActor('officer')
    const result = await sendAnnouncement(deps, actor, {
      body: 'x',
      channels: ['max'],
    })
    expect(result).toMatchObject({ sent: 1, failed: 1 })
    expect(await maxStatus(deps, member.actor)).toMatchObject({
      blocked: true,
    })
  })
})

describe('max: event buttons (MAX-07, MAX-08)', () => {
  it('sends buttons and replaces the previous message', async () => {
    const member = await linked('member')
    const { actor, event } = await officerWithEvent()
    await sendAnnouncement(deps, actor, {
      subject: 'Рейд',
      body: 'Сбор',
      eventId: event.id,
      channels: ['max'],
    })
    expect(sentTo(member.maxUserId)[0]).toMatchObject({
      keyboard: threeButtons(event.id),
    })
    const first = await activeMid(event.id, member.user.id)
    await sendAnnouncement(deps, actor, {
      body: 'Ещё раз',
      eventId: event.id,
      channels: ['max'],
    })
    expect(await activeMid(event.id, member.user.id)).not.toBe(first)
    expect(fake.calls).toContainEqual({
      method: 'editHtml',
      messageId: first,
      text: '<b>Рейд</b>\n\nСбор',
      keyboard: null,
    })
  })

  it('saves an answer by button and offers «Изменить решение»', async () => {
    const member = await linked('member')
    const { actor, event } = await officerWithEvent()
    await sendAnnouncement(deps, actor, {
      body: 'Сбор',
      eventId: event.id,
      channels: ['max'],
    })
    const mid = (await activeMid(event.id, member.user.id))!
    await press(member.maxUserId, mid, answerData(event.id, 'maybe'))
    expect(await answerOf(event.id, member.user.id)).toBe('maybe')
    expect(lastAnswer()).toEqual({
      method: 'answerCallback',
      callbackId: expect.any(String),
      text: 'Ваш ответ: 50/50',
    })
    expect(fake.calls).toContainEqual({
      method: 'editHtml',
      messageId: mid,
      text: 'Сбор\n\n<i>Ваш ответ: 50/50</i>',
      keyboard: changeButton(event.id),
    })

    await press(member.maxUserId, mid, changeData(event.id))
    expect(await answerOf(event.id, member.user.id)).toBe('maybe')
    expect(lastAnswer()).toMatchObject({ text: MAX_CALLBACK_TEXTS.chooseAgain })
    expect(fake.calls.at(-2)).toMatchObject({
      method: 'editHtml',
      keyboard: threeButtons(event.id),
    })
  })

  it('refuses a stale message, an unlinked MAX and a closed event', async () => {
    const member = await linked('member')
    const { actor, event } = await officerWithEvent()
    await sendAnnouncement(deps, actor, {
      body: 'Сбор',
      eventId: event.id,
      channels: ['max'],
    })
    const mid = (await activeMid(event.id, member.user.id))!

    await press(member.maxUserId, 'mid.old', answerData(event.id, 'yes'))
    expect(lastAnswer()).toMatchObject({ text: MAX_CALLBACK_TEXTS.stale })
    expect(fake.calls).toContainEqual({
      method: 'removeKeyboard',
      messageId: 'mid.old',
    })

    await press(99_999, mid, answerData(event.id, 'yes'))
    expect(lastAnswer()).toMatchObject({ text: MAX_CALLBACK_TEXTS.notLinked })

    await closeEvent(deps, actor, { id: event.id })
    await press(member.maxUserId, mid, answerData(event.id, 'yes'))
    expect(lastAnswer()).toMatchObject({ text: MAX_CALLBACK_TEXTS.closed })
    expect(await answerOf(event.id, member.user.id)).toBeNull()

    await press(member.maxUserId, mid, 'garbage')
    expect(lastAnswer()).toMatchObject({ text: MAX_CALLBACK_TEXTS.stale })
  })

  it('skips members who already answered, in every channel (Q-109)', async () => {
    const fresh = await linked('member', true)
    const answered = await linked('member', true)
    const { actor, event } = await officerWithEvent()
    await respondToEvent(deps, answered.actor, {
      eventId: event.id,
      answer: 'maybe',
    })
    expect(
      await broadcastRecipients(deps, actor, { eventId: event.id }),
    ).toMatchObject({
      channels: {
        telegram: { count: 1, answered: 1 },
        max: { count: 1, answered: 1 },
      },
    })
    const result = await sendAnnouncement(deps, actor, {
      body: 'Сбор',
      eventId: event.id,
      channels: ['telegram', 'max'],
    })
    expect(result.channels).toEqual({
      telegram: { recipients: 1, sent: 1, failed: 0 },
      max: { recipients: 1, sent: 1, failed: 0 },
    })
    expect(sentTo(fresh.maxUserId)).toHaveLength(1)
    expect(sentTo(answered.maxUserId)).toEqual([])
    expect(
      tg.calls.filter((c) => c.method === 'sendHtml').map((c) => c.chatId),
    ).toEqual([fresh.maxUserId])

    await respondToEvent(deps, fresh.actor, { eventId: event.id, answer: 'no' })
    await rejects(
      sendAnnouncement(deps, actor, {
        body: 'Ещё раз',
        eventId: event.id,
        channels: ['max'],
      }),
      'state_conflict',
      'all_answered',
    )
  })

  it('syncs answers across the site, Telegram and MAX (MAX-08)', async () => {
    const member = await linked('member', true)
    const { actor, event } = await officerWithEvent()
    await sendAnnouncement(deps, actor, {
      body: 'Сбор',
      eventId: event.id,
      channels: ['telegram', 'max'],
    })
    const mid = (await activeMid(event.id, member.user.id))!
    const tgMessage = await db
      .selectFrom('app.telegram_event_messages')
      .select(['chat_id', 'message_id'])
      .where('user_id', '=', member.user.id)
      .executeTakeFirstOrThrow()

    // Кнопка MAX → сообщение Telegram.
    await press(member.maxUserId, mid, answerData(event.id, 'yes'))
    expect(tg.calls.at(-1)).toMatchObject({
      method: 'editHtml',
      messageId: Number(tgMessage.message_id),
      text: 'Сбор\n\n<i>Ваш ответ: Приду</i>',
    })

    // Кнопка Telegram → сообщение MAX.
    await handleTelegramWebhook(deps, webhookHeaders(), {
      update_id: 1,
      callback_query: {
        id: 'tg-cb',
        from: { id: member.maxUserId, first_name: 'Анна', is_bot: false },
        data: answerData(event.id, 'no'),
        message: {
          message_id: Number(tgMessage.message_id),
          chat: { id: Number(tgMessage.chat_id), type: 'private' },
        },
      },
    })
    expect(fake.calls.at(-1)).toMatchObject({
      method: 'editHtml',
      messageId: mid,
      text: 'Сбор\n\n<i>Ваш ответ: Не приду</i>',
      keyboard: changeButton(event.id),
    })

    // Сайт → оба.
    await respondToEvent(deps, member.actor, {
      eventId: event.id,
      answer: 'maybe',
    })
    expect(fake.calls.at(-1)).toMatchObject({
      text: 'Сбор\n\n<i>Ваш ответ: 50/50</i>',
    })
    expect(tg.calls.at(-1)).toMatchObject({
      text: 'Сбор\n\n<i>Ваш ответ: 50/50</i>',
    })
  })
})

describe('group announcements (TGM-12, TGM-14, Q-104)', () => {
  async function groupWith(members: { user: { id: string } }[]) {
    const { actor, event } = await officerWithEvent()
    const { groups } = await createGroup(deps, actor, {
      eventId: event.id,
      name: 'Пати',
    })
    const groupId = groups[0]!.id
    for (const member of members) {
      await moveMember(deps, actor, {
        eventId: event.id,
        userId: member.user.id,
        groupId,
      })
    }
    return { actor, event, groupId }
  }

  it('reaches only linked members of the group, without buttons', async () => {
    const inGroup = await linked('member', true)
    const outside = await linked('member', true)
    const { actor, event, groupId } = await groupWith([inGroup])

    expect(await broadcastRecipients(deps, actor, { groupId })).toMatchObject({
      channels: {
        telegram: { configured: true, count: 1 },
        max: { configured: true, count: 1 },
      },
    })
    const result = await sendAnnouncement(deps, actor, {
      subject: 'Пати',
      body: 'Сбор группы',
      groupId,
      channels: ['telegram', 'max'],
    })
    expect(result).toMatchObject({ recipients: 2, sent: 2, failed: 0 })
    expect(sentTo(inGroup.maxUserId)).toEqual([
      expect.objectContaining({
        text: '<b>Пати</b>\n\nСбор группы',
        keyboard: null,
      }),
    ])
    expect(sentTo(outside.maxUserId)).toEqual([])
    expect(
      tg.calls.filter((c) => c.method === 'sendHtml').map((c) => c.chatId),
    ).toEqual([inGroup.maxUserId])
    // Анонс группы не становится активным сообщением события.
    expect(await activeMid(event.id, inGroup.user.id)).toBeNull()

    const audit = await db
      .selectFrom('app.audit_log')
      .select(['summary', 'target_kind', 'target_id', 'details'])
      .where('action', '=', 'broadcast_sent')
      .executeTakeFirstOrThrow()
    expect(audit).toMatchObject({
      summary: 'Отправка анонса группы в Telegram и MAX',
      target_kind: 'event',
      target_id: event.id,
      details: { group_id: groupId, source_kind: 'group', event_id: event.id },
    })
  })

  it('still reaches group members who answered the event (Q-109)', async () => {
    const member = await linked('member')
    const { actor, event, groupId } = await groupWith([member])
    await respondToEvent(deps, member.actor, {
      eventId: event.id,
      answer: 'yes',
    })
    expect(await broadcastRecipients(deps, actor, { groupId })).toMatchObject({
      channels: { max: { count: 1 } },
    })
    const result = await sendAnnouncement(deps, actor, {
      body: 'Сбор группы',
      groupId,
      channels: ['max'],
    })
    expect(result).toMatchObject({ recipients: 1, sent: 1 })
  })

  it('refuses an empty, deleted or closed group and a double source', async () => {
    await linked('member')
    const unlinked = { user: await createProfiledUser(db, 'member') }
    const { actor, event, groupId } = await groupWith([unlinked])
    const send = (extra: Record<string, unknown>) =>
      sendAnnouncement(deps, actor, { body: 'x', channels: ['max'], ...extra })
    await rejects(send({ groupId }), 'state_conflict', 'no_recipients')
    await rejects(send({ groupId, eventId: event.id }), 'validation_failed')
    await closeEvent(deps, actor, { id: event.id })
    await rejects(send({ groupId }), 'state_conflict', 'closed')

    const other = await groupWith([])
    await deleteGroup(deps, other.actor, { groupId: other.groupId })
    await rejects(
      send({ groupId: other.groupId }),
      'state_conflict',
      'group_missing',
    )
  })
})

describe('max: vote buttons (MAX-15, VOT-17)', () => {
  async function sendVote(
    vote: Awaited<ReturnType<typeof createVote>>,
    imageUrl: string | null = null,
  ) {
    return deliverMaxAnnouncement(
      deps,
      fake.max,
      { subject: 'Маршрут', body: 'Выберите вариант кнопкой или на сайте.' },
      null,
      null,
      [],
      imageUrl,
      vote.id,
      vote.options,
    )
  }

  it('sends the current choice and shortened long options on MAX buttons', async () => {
    const member = await linked('member')
    const officer = await linked('officer')
    const { actor } = await officerWithEvent()
    const vote = await createVote(deps, actor, {
      title: 'Маршрут',
      context: '',
      options: ['За', 'Большинство участников выберет этот путь'],
    })
    await castBallot(
      { ...deps, max: null, telegram: null, vk: null },
      member.actor,
      {
        voteId: vote.id,
        optionId: vote.options[0]!.id,
      },
    )

    const result = await sendVote(vote)

    expect(result).toEqual({ recipients: 2, sent: 2, failed: 0 })
    const voted = sentTo(member.maxUserId)[0]!
    const open = sentTo(officer.maxUserId)[0]!
    expect(voted.text).toContain('Ваш голос: За')
    expect(voted.keyboard).toEqual([
      [{ type: 'callback', text: 'Изменить решение', payload: 'vc' }],
    ])
    expect(open.text).toContain('2. Большинство участников выберет этот путь')
    expect(open.keyboard?.flat().map((button) => button.text)).toEqual([
      'За',
      expect.stringMatching(/^2\. Большин/),
    ])
  })

  it('saves and changes the ballot from a callback and preserves the image', async () => {
    const member = await linked('member')
    const { actor } = await officerWithEvent()
    const vote = await createVote(deps, actor, {
      title: 'Маршрут',
      context: '',
      options: ['За', 'Против'],
    })
    await sendVote(vote, 'https://murr.test/messenger/vote.jpg')
    const mid = (await activeVoteMid(vote.id, member.user.id))!

    await press(member.maxUserId, mid, voteAnswerData(vote.options[0]!.id))
    expect(lastAnswer()).toMatchObject({ text: 'Ваш голос: За' })
    expect(fake.calls.at(-2)).toMatchObject({
      method: 'editHtml',
      text: expect.stringContaining('Ваш голос: За'),
      keyboard: [
        [{ type: 'callback', text: 'Изменить решение', payload: 'vc' }],
      ],
      image: 'token-vote.jpg',
    })

    await press(member.maxUserId, mid, voteChangeData())
    expect(fake.calls.at(-2)?.keyboard?.flat()).toHaveLength(2)
    await press(member.maxUserId, mid, voteAnswerData(vote.options[1]!.id))
    expect(
      await db
        .selectFrom('app.vote_ballots')
        .select('option_id')
        .where('vote_id', '=', vote.id)
        .where('voter_id', '=', member.user.id)
        .executeTakeFirstOrThrow(),
    ).toMatchObject({ option_id: vote.options[1]!.id })
  })

  it('rejects a message from the previous broadcast', async () => {
    const member = await linked('member')
    const { actor } = await officerWithEvent()
    const vote = await createVote(deps, actor, {
      title: 'Маршрут',
      context: '',
      options: ['За', 'Против'],
    })
    await sendVote(vote)
    const previous = (await activeVoteMid(vote.id, member.user.id))!
    await sendVote(vote)

    await press(member.maxUserId, previous, voteAnswerData(vote.options[0]!.id))

    expect(lastAnswer()).toMatchObject({ text: MAX_CALLBACK_TEXTS.voteStale })
    expect(fake.calls).toContainEqual({
      method: 'removeKeyboard',
      messageId: previous,
    })
    expect(
      await db
        .selectFrom('app.vote_ballots')
        .select('id')
        .where('vote_id', '=', vote.id)
        .execute(),
    ).toEqual([])
  })

  it('rejects a button after the vote is closed', async () => {
    const member = await linked('member')
    const { actor } = await officerWithEvent()
    const vote = await createVote(deps, actor, {
      title: 'Маршрут',
      context: '',
      options: ['За', 'Против'],
    })
    await sendVote(vote)
    const mid = (await activeVoteMid(vote.id, member.user.id))!
    await closeVote(deps, actor, { id: vote.id })

    await press(member.maxUserId, mid, voteAnswerData(vote.options[0]!.id))

    expect(lastAnswer()).toMatchObject({ text: MAX_CALLBACK_TEXTS.voteClosed })
    expect(fake.calls).toContainEqual({
      method: 'removeKeyboard',
      messageId: mid,
    })
    expect(
      await db
        .selectFrom('app.vote_ballots')
        .select('id')
        .where('vote_id', '=', vote.id)
        .execute(),
    ).toEqual([])
  })

  it('updates an active MAX message after a website vote', async () => {
    const member = await linked('member')
    const { actor } = await officerWithEvent()
    const vote = await createVote(deps, actor, {
      title: 'Маршрут',
      context: '',
      options: ['За', 'Против'],
    })
    await sendVote(vote)
    const mid = (await activeVoteMid(vote.id, member.user.id))!

    await castBallot(deps, member.actor, {
      voteId: vote.id,
      optionId: vote.options[1]!.id,
    })

    expect(fake.calls.at(-1)).toMatchObject({
      method: 'editHtml',
      messageId: mid,
      text: expect.stringContaining('Ваш голос: Против'),
      keyboard: [
        [{ type: 'callback', text: 'Изменить решение', payload: 'vc' }],
      ],
    })
  })
})
