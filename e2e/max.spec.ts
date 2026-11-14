import { expect, test } from '@playwright/test'
import { hasHorizontalScroll, openedMessengerUrl, skipSplash } from './helpers'
import {
  botStarted,
  maxPress,
  sendMaxUpdate,
  uniqueMaxUserId,
  waitForMaxCall,
} from './max'
import {
  accessToken,
  callApi,
  createMember,
  expectSignedIn,
  signInUi,
} from './supabase'

test.skip(
  ({ baseURL }) => Boolean(baseURL?.includes('/repository/')),
  'Сценарии MAX проверяются на корневом пути',
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

test('E2E-09: анонс события в MAX и ответ кнопкой', async ({ page }) => {
  const [officer, member] = await Promise.all([
    createMember('officer'),
    createMember('member'),
  ])
  const memberToken = await accessToken(member.email)
  const status = await callApi('max/status', memberToken)
  expect(
    status.body.configured,
    'Функции запущены без бота MAX: перед test:e2e — npm run e2e:functions',
  ).toBe(true)
  const maxUserId = uniqueMaxUserId()

  // Привязка из кабинета: ссылка max.ru/<бот>?start= и «Начать» (MAX-01).
  await signInUi(page, member.email)
  await expectSignedIn(page)
  await page.goto('./#/account')
  const href = await openedMessengerUrl(
    page,
    /^Привязать MAX/,
    /^https:\/\/max\.ru\//,
  )
  expect(href).toMatch(/^https:\/\/max\.ru\/murr_e2e_max_bot\?start=/)
  await sendMaxUpdate(
    botStarted(maxUserId, new URL(href).searchParams.get('start')!),
  )
  await waitForMaxCall(
    maxUserId,
    (call) =>
      call.method === 'POST /messages' &&
      (call.body.text ?? '').includes(member.nickname),
  )
  await page.reload()
  await expect(
    page.getByRole('button', {
      name: new RegExp(`^MAX привязан: @max${maxUserId}`),
    }),
  ).toBeVisible()
  expect(await hasHorizontalScroll(page)).toBe(false)

  // Анонс события только в MAX через API офицера (MAX-05).
  const officerToken = await accessToken(officer.email)
  const title = `E2E MAX ${Date.now()}`
  const event = await callApi('events/create', officerToken, {
    title,
    type: 'pve',
    date: moscowDate(3),
    time: '20:00',
    description: 'Сбор у портала',
  })
  const eventId = event.body.id as string
  const sentResponse = await callApi('broadcasts/send', officerToken, {
    subject: title,
    body: 'Сбор',
    eventId,
    channels: ['max'],
  })
  expect(sentResponse.status).toBe(200)
  const sent = await waitForMaxCall(
    maxUserId,
    (call) =>
      call.method === 'POST /messages' &&
      (call.body.text ?? '').includes(title),
  )
  const buttons = sent.body.attachments![0]!.payload.buttons[0]!
  expect(buttons.map((button) => button.text)).toEqual([
    'Приду',
    '50/50',
    'Не приду',
  ])

  // Кнопка MAX сохраняет ответ на сайте (MAX-07).
  await sendMaxUpdate(maxPress(maxUserId, sent.messageId!, buttons[0]!.payload))
  await waitForMaxCall(
    maxUserId,
    (call) =>
      call.method === 'PUT /messages' &&
      call.query.message_id === sent.messageId &&
      (call.body.text ?? '').includes('Ваш ответ: Приду'),
  )
  await page.goto(`./#/events/${eventId}`)
  await expect(page.getByText('Ваше решение: Приду')).toBeVisible()

  // Ответ на сайте обновляет сообщение в MAX (MAX-08).
  await page.getByRole('button', { name: 'Изменить решение' }).click()
  await page.getByRole('button', { name: 'Не приду', exact: true }).click()
  await expect(page.getByText('Ваше решение: Не приду')).toBeVisible()
  await waitForMaxCall(
    maxUserId,
    (call) =>
      call.method === 'PUT /messages' &&
      call.query.message_id === sent.messageId &&
      (call.body.text ?? '').includes('Ваш ответ: Не приду'),
  )
})
