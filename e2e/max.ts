import { readFileSync } from 'node:fs'
import { expect } from '@playwright/test'
import { localStack } from './supabase'
import { E2E_FUNCTIONS_ENV, FAKE_TELEGRAM_PORT } from './telegram-config'

/** Вызов MAX, записанный фальшивым API (`e2e/fake-telegram.ts`). */
export type FakeMaxCall = {
  method: string
  userId: number | null
  query: Record<string, string>
  body: {
    text?: string
    attachments?: {
      type: string
      payload: { buttons: { text: string; payload: string }[][] }
    }[]
  }
  messageId: string | null
}

function webhookSecret() {
  const content = readFileSync(E2E_FUNCTIONS_ENV, 'utf8')
  const secret = /^MAX_WEBHOOK_SECRET=(.+)$/m.exec(content)?.[1]
  if (!secret) {
    throw new Error(
      `В ${E2E_FUNCTIONS_ENV} нет секрета MAX: перезапустите npm run e2e:functions`,
    )
  }
  return secret
}

/** Апдейт MAX в вебхук функции `api`, как его прислал бы MAX. */
export async function sendMaxUpdate(update: object) {
  const { API_URL } = localStack()
  const response = await fetch(`${API_URL}/functions/v1/api/max/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Max-Bot-Api-Secret': webhookSecret(),
    },
    body: JSON.stringify(update),
  })
  expect(response.status).toBe(200)
}

const maxUser = (userId: number) => ({
  user_id: userId,
  first_name: 'E2E',
  username: `max${userId}`,
  is_bot: false,
})

export function botStarted(userId: number, payload: string) {
  return {
    update_type: 'bot_started',
    timestamp: Date.now(),
    chat_id: userId + 1,
    user: maxUser(userId),
    payload,
  }
}

export function maxPress(userId: number, mid: string, payload: string) {
  return {
    update_type: 'message_callback',
    timestamp: Date.now(),
    callback: {
      timestamp: Date.now(),
      callback_id: `cb${Date.now()}`,
      payload,
      user: maxUser(userId),
    },
    message: {
      recipient: { chat_id: userId + 1, chat_type: 'dialog' },
      body: { mid, seq: 1 },
    },
  }
}

/** Ждёт вызов MAX для пользователя, удовлетворяющий условию. */
export async function waitForMaxCall(
  userId: number,
  match: (call: FakeMaxCall) => boolean,
): Promise<FakeMaxCall> {
  let found: FakeMaxCall | undefined
  await expect
    .poll(
      async () => {
        const response = await fetch(
          `http://127.0.0.1:${FAKE_TELEGRAM_PORT}/max-calls?user=${userId}`,
        )
        found = ((await response.json()) as FakeMaxCall[]).find(match)
        return Boolean(found)
      },
      { timeout: 20_000 },
    )
    .toBe(true)
  return found!
}

/** Уникальный ID пользователя MAX для сценария. */
export function uniqueMaxUserId() {
  return 9_000_000_000 + Math.floor(Math.random() * 1_000_000_000)
}
