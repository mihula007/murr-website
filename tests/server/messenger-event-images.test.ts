import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppDeps } from '../../supabase/functions/_shared/app.ts'
import {
  prefillBroadcast,
  sendAnnouncement,
} from '../../supabase/functions/_shared/broadcasts/service.ts'
import {
  createEvent,
  ensureWeeklyEvents,
  respondToEvent,
} from '../../supabase/functions/_shared/events/service.ts'
import {
  createGroup,
  moveMember,
} from '../../supabase/functions/_shared/groups/service.ts'
import * as eventImages from '../../supabase/functions/_shared/messenger/event-image.ts'
import { eventImageUrl } from '../../supabase/functions/_shared/messenger/event-image.ts'
import {
  closeVote,
  createVote,
} from '../../supabase/functions/_shared/votes/service.ts'
import {
  actorOf,
  createProfiledUser,
  fakeMax,
  fakeTelegram,
  fakeVk,
  resetAppData,
  testDb,
  testDeps,
} from './support.ts'

/** Картинки в анонсах постоянных событий (TGM-27, TGM-28, MAX-13, VK-10). */
const db = testDb()
let telegram: ReturnType<typeof fakeTelegram>
let max: ReturnType<typeof fakeMax>
let vk: ReturnType<typeof fakeVk>
let deps: AppDeps

beforeEach(async () => {
  await resetAppData(db)
  telegram = fakeTelegram()
  max = fakeMax()
  vk = fakeVk()
  deps = {
    ...testDeps(db),
    telegram: telegram.telegram,
    max: max.max,
    vk: vk.vk,
  }
})
afterAll(() => db.destroy())

const TV20 = 'https://murr.test/messenger/tv20.jpg'
const VOTE_IMAGE = 'https://murr.test/messenger/vote.jpg'
const GROUP_IMAGE = 'https://murr.test/messenger/group-list.jpg'
const CHANNELS = ['telegram', 'max', 'vk'] as const
let counter = 50_000

/** Член с привязанными Telegram, MAX и ВКонтакте. */
async function member() {
  const user = await createProfiledUser(db, 'member')
  const id = counter++
  await db
    .insertInto('app.telegram_links')
    .values({
      user_id: user.id,
      telegram_user_id: id,
      chat_id: id,
      display_name: user.nickname,
    })
    .execute()
  await db
    .insertInto('app.max_links')
    .values({
      user_id: user.id,
      max_user_id: id,
      chat_id: id + 1_000_000,
      display_name: user.nickname,
    })
    .execute()
  await db
    .insertInto('app.vk_links')
    .values({
      user_id: user.id,
      vk_user_id: id,
      chat_id: id,
      display_name: user.nickname,
    })
    .execute()
  return { user, id, actor: await actorOf(db, user.id) }
}

async function officer() {
  const user = await createProfiledUser(db, 'officer')
  return actorOf(db, user.id)
}

/** Выпуск «ТВ» в воскресенье 20:00. */
async function weeklyTv20() {
  await ensureWeeklyEvents(deps, await officer(), null)
  const row = await db
    .selectFrom('app.events')
    .select('id')
    .where('recurring_preset', '=', 'tv_sun_20')
    .executeTakeFirstOrThrow()
  return row.id
}

const eventFields = {
  title: 'Рейд',
  type: 'pve',
  date: '2099-11-14',
  time: '20:00',
  description: 'Собираемся у портала',
}

async function activeVote(actor: Awaited<ReturnType<typeof officer>>) {
  return createVote(deps, actor, {
    title: 'Выбор подземелья',
    context: 'Выбираем место для похода',
    options: ['Башня', 'Пещера'],
  })
}

describe('eventImageUrl', () => {
  it('maps the four presets to site files and others to null', () => {
    expect(eventImageUrl('https://pwmurr.ru', 'mtv_sat_20')).toBe(
      'https://pwmurr.ru/messenger/mtv.jpg',
    )
    expect(eventImageUrl('https://pwmurr.ru/', 'sadik_sat_22')).toBe(
      'https://pwmurr.ru/messenger/sad.jpg',
    )
    expect(eventImageUrl('https://pwmurr.ru/', 'tv_sun_22')).toBe(
      'https://pwmurr.ru/messenger/tv22.jpg',
    )
    expect(eventImageUrl('https://pwmurr.ru/', null)).toBeNull()
    expect(eventImageUrl('https://pwmurr.ru/', 'toString')).toBeNull()
    expect(eventImageUrl(null, 'tv_sun_20')).toBeNull()
  })
})

describe('broadcastImageUrl', () => {
  it('maps vote and group sources to static site images', () => {
    expect(eventImages).toHaveProperty('broadcastImageUrl')
    const broadcastImageUrl = Reflect.get(eventImages, 'broadcastImageUrl') as (
      siteUrl: string | null,
      source: 'vote' | 'group',
    ) => string | null

    expect(broadcastImageUrl('https://pwmurr.ru', 'vote')).toBe(
      'https://pwmurr.ru/messenger/vote.jpg',
    )
    expect(broadcastImageUrl('https://pwmurr.ru/', 'group')).toBe(
      'https://pwmurr.ru/messenger/group-list.jpg',
    )
    expect(broadcastImageUrl(null, 'vote')).toBeNull()
  })
})

describe('weekly event announcement with an image', () => {
  it('sends the image in every messenger and keeps it on edits', async () => {
    const eventId = await weeklyTv20()
    const first = await member()
    const second = await member()
    const actor = await officer()

    const result = await sendAnnouncement(deps, actor, {
      subject: 'ТВ',
      body: 'Сбор 19:30',
      eventId,
      channels: [...CHANNELS],
    })
    expect(result).toMatchObject({ recipients: 6, sent: 6, failed: 0 })

    // Telegram: первый — по адресу, остальные — по `file_id`.
    const photos = telegram.calls
      .filter((c) => c.method === 'sendHtml')
      .map((c) => c.photo)
    expect(photos).toEqual([TV20, 'file-tv20.jpg'])
    // MAX и ВКонтакте: одна загрузка на отправку.
    expect(max.calls.filter((c) => c.method === 'uploadImage')).toEqual([
      { method: 'uploadImage', image: TV20 },
    ])
    expect(
      max.calls.filter((c) => c.method === 'sendHtml').map((c) => c.image),
    ).toEqual(['token-tv20.jpg', 'token-tv20.jpg'])
    expect(vk.calls.filter((c) => c.method === 'uploadPhoto')).toHaveLength(1)
    expect(
      vk.calls.filter((c) => c.method === 'send').map((c) => c.attachment),
    ).toEqual(['photo-777_1_key', 'photo-777_1_key'])

    // Ответ на сайте перерисовывает подпись, картинка остаётся.
    telegram.calls.length = 0
    max.calls.length = 0
    vk.calls.length = 0
    await respondToEvent(deps, first.actor, { eventId, answer: 'yes' })
    expect(telegram.calls).toContainEqual(
      expect.objectContaining({
        method: 'editHtml',
        chatId: first.id,
        caption: true,
      }),
    )
    expect(max.calls).toContainEqual(
      expect.objectContaining({ method: 'editHtml', image: 'token-tv20.jpg' }),
    )
    expect(vk.calls).toContainEqual(
      expect.objectContaining({
        method: 'edit',
        peerId: first.id,
        attachment: 'photo-777_1_key',
      }),
    )

    // Повторный анонс снимает кнопки с прежнего сообщения, не трогая картинку.
    telegram.calls.length = 0
    max.calls.length = 0
    vk.calls.length = 0
    await sendAnnouncement(deps, actor, {
      body: 'Напоминание',
      eventId,
      channels: [...CHANNELS],
    })
    expect(telegram.calls).toContainEqual(
      expect.objectContaining({
        method: 'editHtml',
        chatId: second.id,
        keyboard: null,
        caption: true,
      }),
    )
    expect(max.calls).toContainEqual(
      expect.objectContaining({
        method: 'editHtml',
        keyboard: null,
        image: 'token-tv20.jpg',
      }),
    )
    expect(vk.calls).toContainEqual(
      expect.objectContaining({
        method: 'edit',
        peerId: second.id,
        keyboard: null,
        attachment: 'photo-777_1_key',
      }),
    )
  })

  it('falls back to text when the image cannot be sent or uploaded', async () => {
    const eventId = await weeklyTv20()
    const person = await member()
    telegram.failingPhotos.add(TV20)
    max.upload.fails = true
    vk.upload.fails = true

    const result = await sendAnnouncement(deps, await officer(), {
      body: 'Сбор 19:30',
      eventId,
      channels: [...CHANNELS],
    })
    expect(result).toMatchObject({ sent: 3, failed: 0 })
    expect(
      telegram.calls.filter((c) => c.method === 'sendHtml').map((c) => c.photo),
    ).toEqual([TV20, undefined])
    expect(
      max.calls.find((c) => c.method === 'sendHtml')?.image,
    ).toBeUndefined()
    expect(
      vk.calls.find((c) => c.method === 'send')?.attachment,
    ).toBeUndefined()

    // Сообщение без картинки правится как обычное.
    telegram.calls.length = 0
    await respondToEvent(deps, person.actor, { eventId, answer: 'no' })
    const edit = telegram.calls.find((c) => c.method === 'editHtml')
    expect(edit).toBeDefined()
    expect(edit?.caption).toBeUndefined()
  })

  it('sends an ordinary event without an image', async () => {
    await member()
    const actor = await officer()
    const event = await createEvent(deps, actor, {
      title: 'Рейд',
      type: 'pve',
      date: '2099-11-14',
      time: '20:00',
      description: 'Собираемся у портала',
    })
    await sendAnnouncement(deps, actor, {
      body: 'x'.repeat(2000),
      eventId: event.id,
      channels: [...CHANNELS],
    })
    expect(telegram.calls.find((c) => c.method === 'sendHtml')?.photo).toBe(
      undefined,
    )
    expect(max.calls.some((c) => c.method === 'uploadImage')).toBe(false)
    expect(vk.calls.some((c) => c.method === 'uploadPhoto')).toBe(false)
  })
})

describe('source-specific broadcast images', () => {
  it('sends the vote and group images through all selected messengers', async () => {
    const sender = await officer()
    const vote = await activeVote(sender)
    await member()
    await member()

    const voteResult = await sendAnnouncement(deps, sender, {
      subject: 'Голосование',
      body: 'Выбираем место.',
      voteId: vote.id,
      channels: [...CHANNELS],
    })
    expect(voteResult).toMatchObject({ recipients: 6, sent: 6, failed: 0 })
    expect(
      telegram.calls
        .filter((call) => call.method === 'sendHtml')
        .map((call) => call.photo),
    ).toEqual([VOTE_IMAGE, 'file-vote.jpg'])
    expect(
      max.calls
        .filter((call) => call.method === 'uploadImage')
        .map((call) => call.image),
    ).toEqual([VOTE_IMAGE])
    expect(
      max.calls
        .filter((call) => call.method === 'sendHtml')
        .map((call) => call.image),
    ).toEqual(['token-vote.jpg', 'token-vote.jpg'])
    expect(
      vk.calls
        .filter((call) => call.method === 'uploadPhoto')
        .map((call) => call.attachment),
    ).toEqual([VOTE_IMAGE])
    expect(vk.calls.filter((call) => call.method === 'send')).toHaveLength(2)

    telegram.calls.length = 0
    max.calls.length = 0
    vk.calls.length = 0
    const senderMember = await member()
    await member()
    const event = await createEvent(deps, sender, eventFields)
    const { groups } = await createGroup(deps, sender, {
      eventId: event.id,
      name: 'Пати 1',
    })
    const groupId = groups[0]!.id
    await moveMember(deps, sender, {
      eventId: event.id,
      userId: senderMember.user.id,
      groupId,
    })

    const groupResult = await sendAnnouncement(deps, sender, {
      subject: 'Список пати',
      body: 'Состав группы.',
      groupId,
      channels: [...CHANNELS],
    })
    expect(groupResult).toMatchObject({ recipients: 3, sent: 3, failed: 0 })
    expect(
      telegram.calls
        .filter((call) => call.method === 'sendHtml')
        .map((call) => call.photo),
    ).toEqual([GROUP_IMAGE])
    expect(
      max.calls
        .filter((call) => call.method === 'uploadImage')
        .map((call) => call.image),
    ).toEqual([GROUP_IMAGE])
    expect(
      max.calls
        .filter((call) => call.method === 'sendHtml')
        .map((call) => call.image),
    ).toEqual(['token-group-list.jpg'])
    expect(
      vk.calls
        .filter((call) => call.method === 'uploadPhoto')
        .map((call) => call.attachment),
    ).toEqual([GROUP_IMAGE])
    expect(vk.calls.filter((call) => call.method === 'send')).toHaveLength(1)
  })

  it('rejects a closed vote before sending any message', async () => {
    const sender = await officer()
    const vote = await activeVote(sender)
    await closeVote(deps, sender, { id: vote.id })

    await expect(
      sendAnnouncement(deps, sender, {
        body: 'Голосование закрыто.',
        voteId: vote.id,
        channels: [...CHANNELS],
      }),
    ).rejects.toMatchObject({
      code: 'state_conflict',
      fields: { reason: 'closed' },
    })
    expect(telegram.calls).toHaveLength(0)
    expect(max.calls).toHaveLength(0)
    expect(vk.calls).toHaveLength(0)
  })

  it('rejects conflicting vote and event sources before sending', async () => {
    const sender = await officer()
    const vote = await activeVote(sender)
    const event = await createEvent(deps, sender, eventFields)

    await expect(
      sendAnnouncement(deps, sender, {
        body: 'Несовместимые источники.',
        voteId: vote.id,
        eventId: event.id,
        channels: [...CHANNELS],
      }),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      fields: { voteId: 'invalid' },
    })
    expect(telegram.calls).toHaveLength(0)
    expect(max.calls).toHaveLength(0)
    expect(vk.calls).toHaveLength(0)
  })

  it('sends full text if image upload fails in any messenger', async () => {
    const sender = await officer()
    const vote = await activeVote(sender)
    await member()
    telegram.failingPhotos.add(VOTE_IMAGE)
    max.upload.fails = true
    vk.upload.fails = true

    const result = await sendAnnouncement(deps, sender, {
      body: 'Полный текст голосования.',
      voteId: vote.id,
      channels: [...CHANNELS],
    })
    expect(result).toMatchObject({ recipients: 3, sent: 3, failed: 0 })
    expect(
      telegram.calls
        .filter((call) => call.method === 'sendHtml')
        .map((call) => call.photo),
    ).toEqual([VOTE_IMAGE, undefined])
    expect(
      max.calls.find((call) => call.method === 'sendHtml')?.image,
    ).toBeUndefined()
    expect(
      vk.calls.find((call) => call.method === 'send')?.attachment,
    ).toBeUndefined()
  })

  it('sends a long Telegram announcement as a photo and full text', async () => {
    const sender = await officer()
    const vote = await activeVote(sender)
    await member()
    const body = 'x'.repeat(1_100)

    await sendAnnouncement(deps, sender, {
      subject: 'Голосование',
      body,
      voteId: vote.id,
      channels: ['telegram'],
    })

    expect(
      telegram.calls
        .filter(
          (call) => call.method === 'sendPhoto' || call.method === 'sendHtml',
        )
        .map((call) => call.method),
    ).toEqual(['sendPhoto', 'sendHtml'])
    expect(
      telegram.calls.find((call) => call.method === 'sendHtml'),
    ).toMatchObject({
      text: `<b>Голосование</b>\n\n${body}`,
    })
  })
})

describe('weekly event text limit (TGM-28)', () => {
  it('reports the limit in prefill and rejects longer text on send', async () => {
    const eventId = await weeklyTv20()
    await member()
    const actor = await officer()

    const prefill = await prefillBroadcast(deps, actor, {
      source: 'event',
      id: eventId,
    })
    expect(prefill.bodyLimit).toBe(880)

    await expect(
      sendAnnouncement(deps, actor, {
        body: 'x'.repeat(881),
        eventId,
        channels: ['telegram'],
      }),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      fields: { body: 'too_long' },
    })
    expect(telegram.calls).toEqual([])

    const ok = await sendAnnouncement(deps, actor, {
      body: 'x'.repeat(880),
      eventId,
      channels: ['telegram'],
    })
    expect(ok.sent).toBe(1)
  })

  it('keeps the usual limit for an ordinary event', async () => {
    const actor = await officer()
    const event = await createEvent(deps, actor, {
      title: 'Рейд',
      type: 'pve',
      date: '2099-11-14',
      time: '20:00',
      description: 'Собираемся у портала',
    })
    const prefill = await prefillBroadcast(deps, actor, {
      source: 'event',
      id: event.id,
    })
    expect(prefill.bodyLimit).toBeUndefined()
  })
})
