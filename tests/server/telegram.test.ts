import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppDeps } from '../../supabase/functions/_shared/app.ts'
import { GUEST } from '../../supabase/functions/_shared/auth/actor.ts'
import type { AccessRole } from '../../supabase/functions/_shared/contracts/account.ts'
import { BOT_TEXTS } from '../../supabase/functions/_shared/telegram/messages.ts'
import {
  handleTelegramWebhook,
  startTelegramLink,
  telegramStatus,
  unlinkTelegram,
} from '../../supabase/functions/_shared/telegram/service.ts'
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

const rejects = (promise: Promise<unknown>, code: string) =>
  expect(promise).rejects.toMatchObject({ code })

async function roleActor(role: AccessRole) {
  const user = await createProfiledUser(db, role)
  return { user, actor: await actorOf(db, user.id) }
}

type From = { id: number; username?: string; first_name?: string }

let updateId = 1
function messageUpdate(
  from: From,
  text: string,
  chatType: 'private' | 'group' = 'private',
) {
  return {
    update_id: updateId++,
    message: {
      message_id: updateId,
      from: { first_name: 'Анна', ...from, is_bot: false },
      chat: { id: chatType === 'private' ? from.id : -500, type: chatType },
      text,
    },
  }
}

const send = (update: unknown, d: AppDeps = deps) =>
  handleTelegramWebhook(d, webhookHeaders(), update)

/** Код из ссылки `t.me/<бот>?start=<код>`. */
async function linkCode(actor: Awaited<ReturnType<typeof actorOf>>) {
  const { url } = await startTelegramLink(deps, actor)
  return new URL(url).searchParams.get('start')!
}

const replies = () =>
  fake.calls.filter((call) => call.method === 'sendText').map((c) => c.text)

describe('telegram: access (TGM-01, Q-88)', () => {
  it('is open to member, officer and admin only', async () => {
    await rejects(telegramStatus(deps, GUEST), 'not_authenticated')
    await rejects(startTelegramLink(deps, GUEST), 'not_authenticated')
    await rejects(unlinkTelegram(deps, GUEST), 'not_authenticated')
    for (const role of ['applicant', 'reader'] as const) {
      const { actor } = await roleActor(role)
      await rejects(telegramStatus(deps, actor), 'forbidden')
      await rejects(startTelegramLink(deps, actor), 'forbidden')
      await rejects(unlinkTelegram(deps, actor), 'forbidden')
    }
    for (const role of ['member', 'officer', 'admin'] as const) {
      const { actor } = await roleActor(role)
      expect(await telegramStatus(deps, actor)).toEqual({
        configured: true,
        linked: false,
        username: null,
        displayName: null,
        blocked: false,
      })
    }
  })

  it('reports a server without a bot', async () => {
    const plain = testDeps(db)
    const { actor } = await roleActor('member')
    expect(await telegramStatus(plain, actor)).toMatchObject({
      configured: false,
      linked: false,
    })
    await rejects(startTelegramLink(plain, actor), 'telegram_unavailable')
    await rejects(
      handleTelegramWebhook(
        plain,
        webhookHeaders(),
        messageUpdate({ id: 1 }, '/start'),
      ),
      'not_found',
    )
  })
})

describe('telegram: linking (TGM-02–TGM-06, Q-89)', () => {
  it('links by a one-time code and stores only its hash', async () => {
    const { user, actor } = await roleActor('member')
    const { url, expiresAt } = await startTelegramLink(deps, actor)
    const code = new URL(url).searchParams.get('start')!
    expect(url.startsWith('https://t.me/murr_test_bot?start=')).toBe(true)
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(Date.parse(expiresAt) - Date.now()).toBeGreaterThan(14 * 60_000)
    const stored = await db
      .selectFrom('app.telegram_link_codes')
      .select('code_hash')
      .executeTakeFirstOrThrow()
    expect(stored.code_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(stored.code_hash).not.toContain(code)

    await send(messageUpdate({ id: 5001, username: 'anna' }, `/start ${code}`))
    expect(replies()).toEqual([BOT_TEXTS.linked(user.nickname)])
    expect(await telegramStatus(deps, actor)).toEqual({
      configured: true,
      linked: true,
      username: 'anna',
      displayName: 'Анна',
      blocked: false,
    })
    const left = await db
      .selectFrom('app.telegram_link_codes')
      .select('user_id')
      .execute()
    expect(left).toEqual([])
  })

  it('rejects a used, expired or replaced code', async () => {
    const { actor } = await roleActor('member')
    const used = await linkCode(actor)
    await send(messageUpdate({ id: 5001 }, `/start ${used}`))
    await send(messageUpdate({ id: 5002 }, `/start ${used}`))
    expect(replies()[1]).toBe(BOT_TEXTS.linkInvalid)

    const old = await linkCode(actor)
    const fresh = await linkCode(actor)
    await send(messageUpdate({ id: 5003 }, `/start ${old}`))
    expect(replies()[2]).toBe(BOT_TEXTS.linkInvalid)

    const later = { ...deps, now: () => new Date(Date.now() + 16 * 60_000) }
    await send(messageUpdate({ id: 5003 }, `/start ${fresh}`), later)
    expect(replies()[3]).toBe(BOT_TEXTS.linkInvalid)
    // Ссылка по-прежнему на первый Telegram.
    expect(await telegramStatus(deps, actor)).toMatchObject({
      linked: true,
      displayName: 'Анна',
    })
    const link = await db
      .selectFrom('app.telegram_links')
      .select('telegram_user_id')
      .executeTakeFirstOrThrow()
    expect(Number(link.telegram_user_id)).toBe(5001)
  })

  it('keeps one Telegram on one account (TGM-04)', async () => {
    const first = await roleActor('member')
    const second = await roleActor('officer')
    await send(
      messageUpdate({ id: 6001 }, `/start ${await linkCode(first.actor)}`),
    )
    await send(
      messageUpdate({ id: 6001 }, `/start ${await linkCode(second.actor)}`),
    )
    expect(replies()[1]).toBe(BOT_TEXTS.linkTaken)
    expect(await telegramStatus(deps, second.actor)).toMatchObject({
      linked: false,
    })
    expect(await telegramStatus(deps, first.actor)).toMatchObject({
      linked: true,
    })
  })

  it('resolves a race of two accounts for one Telegram', async () => {
    const first = await roleActor('member')
    const second = await roleActor('member')
    const codes = [await linkCode(first.actor), await linkCode(second.actor)]
    await Promise.all(
      codes.map((code) => send(messageUpdate({ id: 6100 }, `/start ${code}`))),
    )
    const texts = replies()
    expect(texts.filter((text) => text === BOT_TEXTS.linkTaken)).toHaveLength(1)
    expect(texts.filter((text) => text?.startsWith('Готово!'))).toHaveLength(1)
    const links = await db
      .selectFrom('app.telegram_links')
      .select('user_id')
      .execute()
    expect(links).toHaveLength(1)
  })

  it('relinks own account to another Telegram', async () => {
    const { actor } = await roleActor('member')
    await send(messageUpdate({ id: 7001 }, `/start ${await linkCode(actor)}`))
    await send(
      messageUpdate(
        { id: 7002, username: 'second' },
        `/start ${await linkCode(actor)}`,
      ),
    )
    expect(await telegramStatus(deps, actor)).toMatchObject({
      linked: true,
      username: 'second',
    })
    const links = await db
      .selectFrom('app.telegram_links')
      .select('telegram_user_id')
      .execute()
    expect(links.map((row) => Number(row.telegram_user_id))).toEqual([7002])
  })

  it('unlinks and drops an unused code (TGM-07)', async () => {
    const { actor } = await roleActor('admin')
    await send(messageUpdate({ id: 8001 }, `/start ${await linkCode(actor)}`))
    await linkCode(actor)
    expect(await unlinkTelegram(deps, actor)).toMatchObject({ linked: false })
    const codes = await db
      .selectFrom('app.telegram_link_codes')
      .select('user_id')
      .execute()
    expect(codes).toEqual([])
  })
})

describe('telegram: webhook (TGM-08, TGM-09)', () => {
  it('rejects a missing or wrong secret', async () => {
    const update = messageUpdate({ id: 9001 }, '/start')
    await rejects(
      handleTelegramWebhook(deps, webhookHeaders(null), update),
      'not_found',
    )
    await rejects(
      handleTelegramWebhook(deps, webhookHeaders('wrong'), update),
      'not_found',
    )
    expect(fake.calls).toEqual([])
  })

  it('ignores malformed updates and group chats', async () => {
    expect(await send({ nonsense: true })).toEqual({})
    expect(await send(messageUpdate({ id: 9002 }, '/start', 'group'))).toEqual(
      {},
    )
    expect(fake.calls).toEqual([])
  })

  it('explains the bot to a stranger with a link to the site', async () => {
    await send(messageUpdate({ id: 9003 }, '/start'))
    await send(messageUpdate({ id: 9003 }, 'привет'))
    expect(replies()).toEqual([
      BOT_TEXTS.helpGuest('https://murr.test/'),
      BOT_TEXTS.helpGuest('https://murr.test/'),
    ])
  })

  it('refreshes the name and clears the blocked mark of a linked user', async () => {
    const { user, actor } = await roleActor('member')
    await send(
      messageUpdate(
        { id: 9004, username: 'old' },
        `/start ${await linkCode(actor)}`,
      ),
    )
    await db
      .updateTable('app.telegram_links')
      .set({ blocked_at: new Date().toISOString() })
      .execute()
    expect(await telegramStatus(deps, actor)).toMatchObject({ blocked: true })

    await send(
      messageUpdate({ id: 9004, username: 'new', first_name: 'Аня' }, 'привет'),
    )
    expect(replies()[1]).toBe(BOT_TEXTS.helpLinked(user.nickname))
    expect(await telegramStatus(deps, actor)).toMatchObject({
      blocked: false,
      username: 'new',
      displayName: 'Аня',
    })
  })
})
