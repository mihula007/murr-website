import { expect, test } from '@playwright/test'
import { hasHorizontalScroll, openedMessengerUrl, skipSplash } from './helpers'
import {
  accessToken,
  callApi,
  createMember,
  expectSignedIn,
  signInUi,
} from './supabase'
import {
  sendVkEvent,
  uniqueVkUserId,
  vkMessage,
  vkPress,
  waitForVkCall,
} from './vk'

test.skip(
  ({ baseURL }) => Boolean(baseURL?.includes('/repository/')),
  'Сценарии ВКонтакте проверяются на корневом пути',
)

test.beforeEach(async ({ page }) => {
  test.setTimeout(180_000)
  await skipSplash(page)
})

function moscowDate(days = 0) {
  return new Date(Date.now() + (3 + 24 * days) * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
}

test('E2E-11: анонс события во ВКонтакте и ответ кнопкой', async ({ page }) => {
  const [officer, member] = await Promise.all([
    createMember('officer'),
    createMember('member'),
  ])
  const memberToken = await accessToken(member.email)
  const status = await callApi('vk/status', memberToken)
  expect(
    status.body.configured,
    'Функции запущены без бота ВКонтакте: перед test:e2e — npm run e2e:functions',
  ).toBe(true)
  const vkUserId = uniqueVkUserId()

  // Подтверждение адреса Callback API (строка из groups.getCallbackConfirmationCode).
  expect(await sendVkEvent('confirmation', {})).toBe('e2e-confirm')

  // Привязка: ссылка vk.me/<сообщество>?ref= и первое сообщение (VK-01).
  await signInUi(page, member.email)
  await expectSignedIn(page)
  await page.goto('./#/account')
  const href = await openedMessengerUrl(
    page,
    /^Привязать ВКонтакте/,
    /^https:\/\/vk\.me\//,
  )
  expect(href).toMatch(/^https:\/\/vk\.me\/murr_e2e\?ref=/)
  expect(
    await sendVkEvent(
      'message_new',
      vkMessage(vkUserId, 'Начать', new URL(href).searchParams.get('ref')!),
    ),
  ).toBe('ok')
  await waitForVkCall(
    vkUserId,
    (call) =>
      call.method === 'messages.send' &&
      (call.params.message ?? '').includes(member.nickname),
  )
  await page.reload()
  await expect(
    page.getByRole('button', {
      name: new RegExp(`^ВКонтакте привязан: @vk${vkUserId}`),
    }),
  ).toBeVisible()
  expect(await hasHorizontalScroll(page)).toBe(false)

  // Анонс события только во ВКонтакте (VK-05, VK-07).
  const officerToken = await accessToken(officer.email)
  const title = `E2E VK ${Date.now()}`
  const event = await callApi('events/create', officerToken, {
    title,
    type: 'pve',
    date: moscowDate(3),
    time: '20:00',
    description: 'Сбор у портала',
  })
  const eventId = event.body.id as string
  expect(
    (
      await callApi('broadcasts/send', officerToken, {
        subject: title,
        body: 'Сбор',
        eventId,
        channels: ['vk'],
      })
    ).status,
  ).toBe(200)
  const sent = await waitForVkCall(
    vkUserId,
    (call) =>
      call.method === 'messages.send' &&
      (call.params.message ?? '').includes(title),
  )
  const keyboard = JSON.parse(sent.params.keyboard!) as {
    buttons: { action: { label: string; payload: string } }[][]
  }
  const buttons = keyboard.buttons[0]!
  expect(buttons.map((button) => button.action.label)).toEqual([
    'Приду',
    '50/50',
    'Не приду',
  ])

  // Кнопка ВКонтакте сохраняет ответ на сайте.
  await sendVkEvent(
    'message_event',
    vkPress(vkUserId, sent.messageId!, buttons[0]!.action.payload),
  )
  await waitForVkCall(
    vkUserId,
    (call) =>
      call.method === 'messages.edit' &&
      call.params.cmid === String(sent.messageId) &&
      (call.params.message ?? '').includes('Ваш ответ: Приду'),
  )
  await page.goto(`./#/events/${eventId}`)
  await expect(page.getByText('Ваше решение: Приду')).toBeVisible()

  // Ответ на сайте обновляет сообщение ВКонтакте.
  await page.getByRole('button', { name: 'Изменить решение' }).click()
  await page.getByRole('button', { name: 'Не приду', exact: true }).click()
  await expect(page.getByText('Ваше решение: Не приду')).toBeVisible()
  await waitForVkCall(
    vkUserId,
    (call) =>
      call.method === 'messages.edit' &&
      call.params.cmid === String(sent.messageId) &&
      (call.params.message ?? '').includes('Ваш ответ: Не приду'),
  )
})
