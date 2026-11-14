import { expect, test, type Browser } from '@playwright/test'
import { hasHorizontalScroll, skipSplash } from './helpers'
import {
  accessToken,
  callApi,
  createMember,
  expectSignedIn,
  signInUi,
} from './supabase'
import {
  pressUpdate,
  sendUpdate,
  startUpdate,
  uniqueChatId,
  waitForCall,
} from './telegram'

test.skip(
  ({ baseURL }) => Boolean(baseURL?.includes('/repository/')),
  'Сценарии Telegram проверяются на корневом пути',
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

async function signedInPage(browser: Browser, email: string) {
  const context = await browser.newContext({ ...test.info().project.use })
  const page = await context.newPage()
  await skipSplash(page)
  await signInUi(page, email)
  await expectSignedIn(page)
  return page
}

test('E2E-08: анонс события в Telegram и ответ кнопкой', async ({
  page,
  browser,
}) => {
  const [officer, member] = await Promise.all([
    createMember('officer'),
    createMember('member'),
  ])
  const memberToken = await accessToken(member.email)
  const status = await callApi('telegram/status', memberToken)
  expect(
    status.body.configured,
    'Функции запущены без бота: перед test:e2e — npm run e2e:functions',
  ).toBe(true)
  const chatId = uniqueChatId()

  // Привязка из кабинета: одноразовая ссылка на бота и «Запустить» (TGM-02).
  await signInUi(page, member.email)
  await expectSignedIn(page)
  await page.goto('./#/account')
  const block = page.getByRole('region', { name: 'Telegram' })
  await block.getByRole('button', { name: 'Привязать Telegram' }).click()
  const link = block.getByRole('link', { name: 'Открыть бота' })
  await expect(link).toHaveAttribute('target', '_blank')
  const href = (await link.getAttribute('href'))!
  expect(href).toMatch(/^https:\/\/t\.me\/murr_e2e_bot\?start=/)
  await sendUpdate(
    startUpdate(chatId, new URL(href).searchParams.get('start')!),
  )
  await waitForCall(
    chatId,
    (call) =>
      call.method === 'sendMessage' &&
      (call.params.text ?? '').includes(member.nickname),
  )
  await page.reload()
  await expect(block.getByText(`@e2e${chatId}`)).toBeVisible()
  expect(await hasHorizontalScroll(page)).toBe(false)

  // Анонс события от офицера: подтверждение и кнопки ответа (TGM-11, TGM-18).
  const title = `E2E Telegram ${Date.now()}`
  const event = await callApi(
    'events/create',
    await accessToken(officer.email),
    {
      title,
      type: 'pve',
      date: moscowDate(3),
      time: '20:00',
      description: 'Сбор у портала',
    },
  )
  expect(event.status).toBe(200)
  const eventId = event.body.id as string
  const officerPage = await signedInPage(browser, officer.email)
  await officerPage.goto(`./#/broadcast?source=event&id=${eventId}`)
  await expect(officerPage.getByText(/^Анонс события/)).toBeVisible()
  await expect(
    officerPage.getByRole('checkbox', { name: /ВКонтакте/ }),
  ).toBeDisabled()
  await officerPage
    .getByRole('button', { name: 'Отправить в Telegram' })
    .click()
  const dialog = officerPage.getByRole('alertdialog')
  await expect(dialog.getByText(/Получателей: \d+/)).toBeVisible()
  await dialog.getByRole('button', { name: 'Отправить', exact: true }).click()
  await expect(
    officerPage.getByText(/^Отправлено в Telegram: \d+/),
  ).toBeVisible()
  expect(await hasHorizontalScroll(officerPage)).toBe(false)

  const sent = await waitForCall(
    chatId,
    (call) =>
      call.method === 'sendMessage' && (call.params.text ?? '').includes(title),
  )
  const buttons = sent.params.reply_markup!.inline_keyboard[0]!
  expect(buttons.map((button) => button.text)).toEqual([
    'Приду',
    '50/50',
    'Не приду',
  ])

  // Кнопка в Telegram сохраняет ответ на сайте (TGM-18, TGM-19).
  await sendUpdate(
    pressUpdate(chatId, sent.messageId!, buttons[0]!.callback_data),
  )
  await waitForCall(
    chatId,
    (call) =>
      call.method === 'editMessageText' &&
      call.params.message_id === sent.messageId &&
      (call.params.text ?? '').includes('Ваш ответ: Приду'),
  )
  await page.goto(`./#/events/${eventId}`)
  await expect(page.getByText('Ваше решение: Приду')).toBeVisible()

  // Ответ на сайте обновляет сообщение в Telegram (TGM-21).
  await page.getByRole('button', { name: 'Изменить решение' }).click()
  await page.getByRole('button', { name: 'Не приду', exact: true }).click()
  await expect(page.getByText('Ваше решение: Не приду')).toBeVisible()
  await waitForCall(
    chatId,
    (call) =>
      call.method === 'editMessageText' &&
      call.params.message_id === sent.messageId &&
      (call.params.text ?? '').includes('Ваш ответ: Не приду'),
  )

  // Член клана не отправляет анонсы: прямой вызов отклоняется.
  expect(
    (await callApi('broadcasts/send', memberToken, { body: 'x' })).status,
  ).toBe(403)
})
