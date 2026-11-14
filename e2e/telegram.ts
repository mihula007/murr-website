import { readFileSync } from 'node:fs'
import { expect } from '@playwright/test'
import { localStack } from './supabase'
import { E2E_FUNCTIONS_ENV, FAKE_TELEGRAM_PORT } from './telegram-config'

/** Вызов, записанный фальшивым Bot API. */
export type FakeCall = {
  method: string
  params: {
    chat_id?: number
    message_id?: number
    text?: string
    reply_markup?: {
      inline_keyboard: { text: string; callback_data: string }[][]
    }
  }
  messageId: number | null
}

/** Секрет вебхука из env-файла `npm run e2e:functions`. */
function webhookSecret() {
  let content: string
  try {
    content = readFileSync(E2E_FUNCTIONS_ENV, 'utf8')
  } catch {
    throw new Error(
      `Нет ${E2E_FUNCTIONS_ENV}: перед test:e2e запустите npm run e2e:functions`,
    )
  }
  const secret = /^TELEGRAM_WEBHOOK_SECRET=(.+)$/m.exec(content)?.[1]
  if (!secret) {
    throw new Error(`В ${E2E_FUNCTIONS_ENV} нет секрета вебхука`)
  }
  return secret
}

/** Апдейт Telegram в вебхук функции `api`, как его прислал бы Telegram. */
export async function sendUpdate(update: object) {
  const { API_URL } = localStack()
  const response = await fetch(`${API_URL}/functions/v1/api/telegram/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Bot-Api-Secret-Token': webhookSecret(),
    },
    body: JSON.stringify(update),
  })
  expect(response.status).toBe(200)
}

let updateId = Date.now()

export function startUpdate(chatId: number, code: string) {
  return {
    update_id: updateId++,
    message: {
      message_id: 1,
      from: {
        id: chatId,
        is_bot: false,
        first_name: 'E2E',
        username: `e2e${chatId}`,
      },
      chat: { id: chatId, type: 'private' },
      text: `/start ${code}`,
    },
  }
}

export function pressUpdate(chatId: number, messageId: number, data: string) {
  return {
    update_id: updateId++,
    callback_query: {
      id: `cb${updateId}`,
      from: { id: chatId, is_bot: false, first_name: 'E2E' },
      data,
      message: { message_id: messageId, chat: { id: chatId, type: 'private' } },
    },
  }
}

/** Вызовы фальшивого Bot API для чата. */
export async function callsFor(chatId: number): Promise<FakeCall[]> {
  const response = await fetch(
    `http://127.0.0.1:${FAKE_TELEGRAM_PORT}/calls?chat=${chatId}`,
  )
  return (await response.json()) as FakeCall[]
}

/** Ждёт вызов Bot API для чата, удовлетворяющий условию. */
export async function waitForCall(
  chatId: number,
  match: (call: FakeCall) => boolean,
): Promise<FakeCall> {
  let found: FakeCall | undefined
  await expect
    .poll(
      async () => {
        found = (await callsFor(chatId)).find(match)
        return Boolean(found)
      },
      { timeout: 20_000 },
    )
    .toBe(true)
  return found!
}

/** Уникальный ID чата Telegram для сценария (параллельные проекты). */
export function uniqueChatId() {
  return 7_000_000_000 + Math.floor(Math.random() * 1_000_000_000)
}
