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
  answerData,
  changeData,
} from '../../supabase/functions/_shared/messenger/callback-data.ts'
import {
  VK_BOT_TEXTS,
  VK_CALLBACK_TEXTS,
} from '../../supabase/functions/_shared/vk/messages.ts'
import {
  handleVkWebhook,
  startVkLink,
  unlinkVk,
  vkStatus,
} from '../../supabase/functions/_shared/vk/service.ts'
import {
  actorOf,
  createProfiledUser,
  fakeMax,
  fakeTelegram,
  fakeVk,
  resetAppData,
  testDb,
  testDeps,
  VK_TEST_GROUP_ID,
  VK_TEST_SECRET,
} from './support.ts'

const db = testDb()
let fake: ReturnType<typeof fakeVk>
let tg: ReturnType<typeof fakeTelegram>
let mx: ReturnType<typeof fakeMax>
let deps: AppDeps

beforeEach(async () => {
  await resetAppData(db)
  fake = fakeVk()
  tg = fakeTelegram()
  mx = fakeMax()
  deps = {
    ...testDeps(db),
    vk: fake.vk,
    telegram: tg.telegram,
    max: mx.max,
  }
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

const envelope = (type: string, object: unknown = {}) => ({
  type,
  object,
  group_id: VK_TEST_GROUP_ID,
  event_id: `e${Math.random()}`,
  v: '5.199',
  secret: VK_TEST_SECRET,
})

const hook = (body: unknown, d: AppDeps = deps) => handleVkWebhook(d, body)

/** Ответ вебхука простым текстом. */
async function hookText(body: unknown, d: AppDeps = deps) {
  return (await hook(body, d)).text()
}

const messageNew = (userId: number, text: string, ref?: string) =>
  envelope('message_new', {
    message: {
      from_id: userId,
      peer_id: userId,
      text,
      ...(ref ? { ref } : {}),
    },
  })

async function linkCode(actor: Awaited<ReturnType<typeof actorOf>>) {
  const { url } = await startVkLink(deps, actor)
  return new URL(url).searchParams.get('ref')!
}

const replies = () =>
  fake.calls.filter((c) => c.method === 'send').map((c) => c.text)

let vkCounter = 60_000

async function linked(role: AccessRole) {
  const user = await createProfiledUser(db, role)
  const vkUserId = vkCounter++
  await db
    .insertInto('app.vk_links')
    .values({
      user_id: user.id,
      vk_user_id: vkUserId,
      chat_id: vkUserId,
      display_name: user.nickname,
    })
    .execute()
  await db
    .insertInto('app.telegram_links')
    .values({
      user_id: user.id,
      telegram_user_id: vkUserId,
      chat_id: vkUserId,
      display_name: user.nickname,
    })
    .execute()
  return { user, vkUserId, actor: await actorOf(db, user.id) }
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

async function activeCmid(eventId: string, userId: string) {
  const row = await db
    .selectFrom('app.vk_event_messages')
    .select('message_id')
    .where('event_id', '=', eventId)
    .where('user_id', '=', userId)
    .executeTakeFirst()
  return row ? Number(row.message_id) : null
}

const payload = (data: string) => ({ d: data })

function press(vkUserId: number, cmid: number, data: unknown) {
  return hook(
    envelope('message_event', {
      user_id: vkUserId,
      peer_id: vkUserId,
      event_id: `ev${Math.random()}`,
      payload: data,
      conversation_message_id: cmid,
    }),
  )
}

const lastAnswer = () =>
  fake.calls.filter((c) => c.method === 'answerEvent').at(-1)

async function answerOf(eventId: string, userId: string) {
  const row = await db
    .selectFrom('app.event_attendance')
    .select('answer')
    .where('event_id', '=', eventId)
    .where('user_id', '=', userId)
    .executeTakeFirst()
  return row?.answer ?? null
}

const button = (label: string, data: string) => ({
  action: { type: 'callback', label, payload: JSON.stringify({ d: data }) },
})
const threeButtons = (eventId: string) => [
  [
    button('Приду', answerData(eventId, 'yes')),
    button('50/50', answerData(eventId, 'maybe')),
    button('Не приду', answerData(eventId, 'no')),
  ],
]
const changeButton = (eventId: string) => [
  [button('Изменить решение', changeData(eventId))],
]

describe('vk: access (VK-01)', () => {
  it('is open to member, officer and admin only', async () => {
    await rejects(vkStatus(deps, GUEST), 'not_authenticated')
    for (const role of ['applicant', 'reader'] as const) {
      const { actor } = await roleActor(role)
      await rejects(vkStatus(deps, actor), 'forbidden')
      await rejects(startVkLink(deps, actor), 'forbidden')
      await rejects(unlinkVk(deps, actor), 'forbidden')
    }
    const { actor } = await roleActor('member')
    expect(await vkStatus(deps, actor)).toEqual({
      configured: true,
      linked: false,
      username: null,
      displayName: null,
      blocked: false,
    })
    const bare = testDeps(db)
    expect(await vkStatus(bare, actor)).toMatchObject({ configured: false })
    await rejects(startVkLink(bare, actor), 'vk_unavailable')
  })
})

describe('vk: callback API (VK-01, VK-03)', () => {
  it('confirms the server and answers ok as plain text', async () => {
    expect(await hookText(envelope('confirmation'))).toBe('confirm-123')
    expect(await hookText(envelope('wall_post_new'))).toBe('ok')
    expect(await hookText(envelope('message_new', { nonsense: 1 }))).toBe('ok')
  })

  it('rejects a foreign group, a wrong secret and a missing bot', async () => {
    await rejects(
      hook({ ...envelope('confirmation'), group_id: 1 }),
      'not_found',
    )
    await rejects(
      hook({ ...envelope('confirmation'), secret: 'wrong' }),
      'not_found',
    )
    const { secret: _secret, ...noSecret } = envelope('confirmation')
    await rejects(hook(noSecret), 'not_found')
    await rejects(hook(envelope('confirmation'), testDeps(db)), 'not_found')
  })

  it('links by ref of the first message and stores only the code hash', async () => {
    const { user, actor } = await roleActor('member')
    const { url } = await startVkLink(deps, actor)
    expect(url.startsWith('https://vk.me/murr_test?ref=')).toBe(true)
    const code = new URL(url).searchParams.get('ref')!
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(await hookText(messageNew(4001, 'Начать', code))).toBe('ok')
    expect(replies()).toEqual([VK_BOT_TEXTS.linked(user.nickname)])
    expect(fake.calls.at(-1)).toMatchObject({ peerId: 4001 })
    expect(await vkStatus(deps, actor)).toEqual({
      configured: true,
      linked: true,
      username: 'id4001',
      displayName: 'Анна',
      blocked: false,
    })
  })

  it('rejects a used code, a taken VK and ignores group chats', async () => {
    const first = await roleActor('member')
    const second = await roleActor('member')
    const code = await linkCode(first.actor)
    await hook(messageNew(4002, 'Начать', code))
    await hook(messageNew(4003, 'Начать', code))
    expect(replies().at(-1)).toBe(VK_BOT_TEXTS.linkInvalid)
    await hook(messageNew(4002, 'Начать', await linkCode(second.actor)))
    expect(replies().at(-1)).toBe(VK_BOT_TEXTS.linkTaken)

    const before = fake.calls.length
    await hook(
      envelope('message_new', {
        message: { from_id: 4004, peer_id: 2_000_000_001, text: 'привет' },
      }),
    )
    expect(fake.calls).toHaveLength(before)
  })

  it('explains the bot and tracks denied and allowed messages', async () => {
    await hook(messageNew(4005, 'привет'))
    expect(replies()).toEqual([VK_BOT_TEXTS.helpGuest('https://murr.test/')])
    const { user, actor } = await roleActor('member')
    await hook(messageNew(4006, 'Начать', await linkCode(actor)))
    await hook(envelope('message_deny', { user_id: 4006 }))
    expect(await vkStatus(deps, actor)).toMatchObject({ blocked: true })
    await hook(envelope('message_allow', { user_id: 4006, key: '' }))
    expect(await vkStatus(deps, actor)).toMatchObject({ blocked: false })
    await hook(envelope('message_deny', { user_id: 4006 }))
    await hook(messageNew(4006, 'снова я'))
    expect(await vkStatus(deps, actor)).toMatchObject({ blocked: false })
    expect(replies().at(-1)).toBe(VK_BOT_TEXTS.helpLinked(user.nickname))
  })
})

describe('vk: announcements (VK-05, VK-06, VK-09)', () => {
  it('counts VK recipients and sends plain text to the chosen channels', async () => {
    const member = await linked('member')
    await linked('reader')
    const { actor } = await roleActor('admin')
    expect(await broadcastRecipients(deps, actor)).toMatchObject({
      channels: { vk: { configured: true, count: 1 } },
    })
    const result = await sendAnnouncement(deps, actor, {
      subject: 'Сбор',
      body: 'Сегодня <в 20:00>',
      channels: ['telegram', 'vk', 'max'],
    })
    expect(result.channels).toEqual({
      telegram: { recipients: 1, sent: 1, failed: 0 },
      vk: { recipients: 1, sent: 1, failed: 0 },
      max: { recipients: 0, sent: 0, failed: 0 },
    })
    expect(fake.calls).toEqual([
      {
        method: 'send',
        peerId: member.vkUserId,
        text: 'Сбор\n\nСегодня <в 20:00>',
        keyboard: null,
      },
    ])
    const audit = await db
      .selectFrom('app.audit_log')
      .select(['summary', 'details'])
      .where('action', '=', 'broadcast_sent')
      .executeTakeFirstOrThrow()
    expect(audit.summary).toBe('Отправка анонса в Telegram, ВКонтакте и MAX')
    expect(audit.details).toMatchObject({ vk_sent: 1, vk_failed: 0 })
  })

  it('refuses an unconfigured VK and marks denied messages', async () => {
    const member = await linked('member')
    const { actor } = await roleActor('officer')
    await rejects(
      sendAnnouncement({ ...deps, vk: null }, actor, {
        body: 'x',
        channels: ['vk'],
      }),
      'vk_unavailable',
    )
    fake.blocked.add(member.vkUserId)
    const result = await sendAnnouncement(deps, actor, {
      body: 'x',
      channels: ['vk'],
    })
    expect(result).toMatchObject({ sent: 0, failed: 1 })
    expect(await vkStatus(deps, member.actor)).toMatchObject({
      blocked: true,
    })
  })
})

describe('vk: event buttons (VK-07, VK-08)', () => {
  async function announced() {
    const member = await linked('member')
    const { actor, event } = await officerWithEvent()
    await sendAnnouncement(deps, actor, {
      body: 'Сбор',
      eventId: event.id,
      channels: ['vk', 'telegram'],
    })
    const cmid = (await activeCmid(event.id, member.user.id))!
    return { member, actor, event, cmid }
  }

  it('sends buttons and replaces the previous message', async () => {
    const { member, actor, event, cmid } = await announced()
    expect(fake.calls[0]).toMatchObject({
      method: 'send',
      keyboard: threeButtons(event.id),
    })
    await sendAnnouncement(deps, actor, {
      subject: 'Рейд',
      body: 'Ещё раз',
      eventId: event.id,
      channels: ['vk'],
    })
    expect(await activeCmid(event.id, member.user.id)).not.toBe(cmid)
    expect(fake.calls).toContainEqual({
      method: 'edit',
      peerId: member.vkUserId,
      messageId: cmid,
      text: 'Сбор',
      keyboard: null,
    })
  })

  it('skips members who already answered (Q-109)', async () => {
    const fresh = await linked('member')
    const answered = await linked('member')
    const { actor, event } = await officerWithEvent()
    await respondToEvent(deps, answered.actor, {
      eventId: event.id,
      answer: 'yes',
    })
    expect(
      await broadcastRecipients(deps, actor, { eventId: event.id }),
    ).toMatchObject({ channels: { vk: { count: 1, answered: 1 } } })
    const result = await sendAnnouncement(deps, actor, {
      body: 'Сбор',
      eventId: event.id,
      channels: ['vk'],
    })
    expect(result).toMatchObject({ recipients: 1, sent: 1, failed: 0 })
    expect(
      fake.calls.filter((c) => c.method === 'send').map((c) => c.peerId),
    ).toEqual([fresh.vkUserId])

    await respondToEvent(deps, fresh.actor, { eventId: event.id, answer: 'no' })
    await rejects(
      sendAnnouncement(deps, actor, {
        body: 'Ещё раз',
        eventId: event.id,
        channels: ['vk'],
      }),
      'state_conflict',
      'all_answered',
    )
  })

  it('saves an answer, offers «Изменить решение» and syncs Telegram', async () => {
    const { member, event, cmid } = await announced()
    await press(member.vkUserId, cmid, payload(answerData(event.id, 'maybe')))
    expect(await answerOf(event.id, member.user.id)).toBe('maybe')
    expect(lastAnswer()).toEqual({
      method: 'answerEvent',
      eventId: expect.any(String),
      peerId: member.vkUserId,
      text: 'Ваш ответ: 50/50',
    })
    expect(fake.calls).toContainEqual({
      method: 'edit',
      peerId: member.vkUserId,
      messageId: cmid,
      text: 'Сбор\n\nВаш ответ: 50/50',
      keyboard: changeButton(event.id),
    })
    expect(tg.calls.at(-1)).toMatchObject({
      method: 'editHtml',
      text: 'Сбор\n\n<i>Ваш ответ: 50/50</i>',
    })

    // Payload строкой JSON тоже принимается.
    await press(
      member.vkUserId,
      cmid,
      JSON.stringify(payload(changeData(event.id))),
    )
    expect(await answerOf(event.id, member.user.id)).toBe('maybe')
    expect(lastAnswer()).toMatchObject({ text: VK_CALLBACK_TEXTS.chooseAgain })
    expect(fake.calls.at(-2)).toMatchObject({
      method: 'edit',
      keyboard: threeButtons(event.id),
    })

    // Ответ на сайте обновляет сообщение ВКонтакте.
    await respondToEvent(deps, member.actor, {
      eventId: event.id,
      answer: 'no',
    })
    expect(fake.calls.at(-1)).toMatchObject({
      method: 'edit',
      text: 'Сбор\n\nВаш ответ: Не приду',
    })
  })

  it('shows the answer in a notification when the message is too old (VK-08)', async () => {
    const { member, event, cmid } = await announced()
    fake.expired.add(cmid)
    await press(member.vkUserId, cmid, payload(answerData(event.id, 'yes')))
    expect(await answerOf(event.id, member.user.id)).toBe('yes')
    expect(lastAnswer()).toMatchObject({ text: 'Ваш ответ: Приду' })
  })

  it('refuses stale, unlinked and closed presses', async () => {
    const { member, actor, event, cmid } = await announced()
    await press(
      member.vkUserId,
      cmid + 100,
      payload(answerData(event.id, 'yes')),
    )
    expect(lastAnswer()).toMatchObject({ text: VK_CALLBACK_TEXTS.stale })
    await press(99_999, cmid, payload(answerData(event.id, 'yes')))
    expect(lastAnswer()).toMatchObject({ text: VK_CALLBACK_TEXTS.notLinked })
    await press(member.vkUserId, cmid, payload('garbage'))
    expect(lastAnswer()).toMatchObject({ text: VK_CALLBACK_TEXTS.stale })

    await closeEvent(deps, actor, { id: event.id })
    await press(member.vkUserId, cmid, payload(answerData(event.id, 'yes')))
    expect(lastAnswer()).toMatchObject({ text: VK_CALLBACK_TEXTS.closed })
    expect(fake.calls.at(-2)).toMatchObject({
      method: 'edit',
      messageId: cmid,
      text: 'Сбор',
      keyboard: null,
    })
    expect(await answerOf(event.id, member.user.id)).toBeNull()
  })
})
