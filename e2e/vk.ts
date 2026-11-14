import { readFileSync } from 'node:fs'
import { expect } from '@playwright/test'
import { localStack } from './supabase'
import { E2E_FUNCTIONS_ENV, FAKE_TELEGRAM_PORT } from './telegram-config'

/** Вызов ВКонтакте, записанный фальшивым API (`e2e/fake-telegram.ts`). */
export type FakeVkCall = {
  method: string
  peer: number | null
  params: Record<string, string>
  messageId: number | null
}

/** ID сообщества и секрет Callback API из env-файла `npm run e2e:functions`. */
function callbackSettings() {
  const content = readFileSync(E2E_FUNCTIONS_ENV, 'utf8')
  const secret = /^VK_CALLBACK_SECRET=(.+)$/m.exec(content)?.[1]
  const groupId = Number(/^VK_GROUP_ID=(.+)$/m.exec(content)?.[1])
  if (!secret || !groupId) {
    throw new Error(
      `В ${E2E_FUNCTIONS_ENV} нет настроек ВКонтакте: перезапустите npm run e2e:functions`,
    )
  }
  return { secret, groupId }
}

/** Событие Callback API в вебхук функции `api`; возвращает текст ответа. */
export async function sendVkEvent(type: string, object: unknown) {
  const { API_URL } = localStack()
  const { secret, groupId } = callbackSettings()
  const response = await fetch(`${API_URL}/functions/v1/api/vk/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type,
      object,
      group_id: groupId,
      event_id: `e2e${Date.now()}`,
      v: '5.199',
      secret,
    }),
  })
  expect(response.status).toBe(200)
  return response.text()
}

export function vkMessage(userId: number, text: string, ref?: string) {
  return {
    message: {
      from_id: userId,
      peer_id: userId,
      text,
      ...(ref ? { ref } : {}),
    },
  }
}

export function vkPress(userId: number, cmid: number, payload: string) {
  return {
    user_id: userId,
    peer_id: userId,
    event_id: `ev${Date.now()}`,
    payload: JSON.parse(payload) as unknown,
    conversation_message_id: cmid,
  }
}

/** Ждёт вызов ВКонтакте для получателя, удовлетворяющий условию. */
export async function waitForVkCall(
  peer: number,
  match: (call: FakeVkCall) => boolean,
): Promise<FakeVkCall> {
  let found: FakeVkCall | undefined
  await expect
    .poll(
      async () => {
        const response = await fetch(
          `http://127.0.0.1:${FAKE_TELEGRAM_PORT}/vk-calls?peer=${peer}`,
        )
        found = ((await response.json()) as FakeVkCall[]).find(match)
        return Boolean(found)
      },
      { timeout: 20_000 },
    )
    .toBe(true)
  return found!
}

/** Уникальный ID пользователя ВКонтакте для сценария. */
export function uniqueVkUserId() {
  return 500_000_000 + Math.floor(Math.random() * 1_000_000_000)
}
