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
  MAX_BOT_TEXTS,
  MAX_CALLBACK_TEXTS,
} from '../../supabase/functions/_shared/max/messages.ts'
import {
  handleMaxWebhook,
  maxStatus,
  startMaxLink,
  unlinkMax,
} from '../../supabase/functions/_shared/max/service.ts'
import {
  answerData,
  changeData,
} from '../../supabase/functions/_shared/messenger/callback-data.ts'
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
    expect(await broadcastRecipients(deps, actor)).toEqual({
      count: 1,
      channels: {
        telegram: { configured: true, count: 1 },
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
      sendAnnouncement(deps, actor, { body: 'x', channels: ['vk'] }),
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
    })
    expect(fake.calls).toContainEqual({
      method: 'editHtml',
      messageId: mid,
      text: 'Сбор\n\n<i>Ваш ответ: 50/50</i>',
      keyboard: changeButton(event.id),
    })

    await press(member.maxUserId, mid, changeData(event.id))
    expect(await answerOf(event.id, member.user.id)).toBe('maybe')
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
