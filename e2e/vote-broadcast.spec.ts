import { expect, test, type Browser } from '@playwright/test'
import { skipSplash } from './helpers'
import {
  accessToken,
  callApi,
  createMember,
  expectSignedIn,
  signInUi,
  sql,
} from './supabase'
import {
  callsFor,
  pressUpdate,
  sendUpdate,
  uniqueChatId,
  waitForCall,
} from './telegram'
import { maxPress, sendMaxUpdate, uniqueMaxUserId, waitForMaxCall } from './max'
import { sendVkEvent, uniqueVkUserId, vkPress, waitForVkCall } from './vk'

test.skip(
  ({ baseURL }) => Boolean(baseURL?.includes('/repository/')),
  'Сценарии рассылок проверяются на корневом пути',
)

test.beforeEach(async ({ page }) => {
  test.setTimeout(180_000)
  await skipSplash(page)
})

async function signedInPage(browser: Browser, email: string) {
  const context = await browser.newContext({ ...test.info().project.use })
  const page = await context.newPage()
  await skipSplash(page)
  await signInUi(page, email)
  await expectSignedIn(page)
  return page
}

test('E2E-12: рассылка голосования и ответы из трёх мессенджеров', async ({
  page,
  browser,
}) => {
  const [officer, member] = await Promise.all([
    createMember('officer'),
    createMember('member'),
  ])
  const officerToken = await accessToken(officer.email)
  const [telegramStatus, maxStatus, vkStatus] = await Promise.all([
    callApi('telegram/status', await accessToken(member.email)),
    callApi('max/status', await accessToken(member.email)),
    callApi('vk/status', await accessToken(member.email)),
  ])
  expect(telegramStatus.body.configured).toBe(true)
  expect(maxStatus.body.configured).toBe(true)
  expect(vkStatus.body.configured).toBe(true)

  const title = `E2E кнопки голосования ${Date.now()}`
  const longOption =
    'Большинство участников выберет этот маршрут для следующего рейда'
  const created = await callApi('votes/create', officerToken, {
    title,
    context: 'Проверяем ответы прямо из мессенджеров.',
    options: ['За', longOption],
  })
  expect(created.status).toBe(200)
  const voteId = created.body.id as string
  const telegramChatId = uniqueChatId()
  const maxUserId = uniqueMaxUserId()
  const vkUserId = uniqueVkUserId()
  await sql(async (db) => {
    await db`
      insert into app.telegram_links
        (user_id, telegram_user_id, chat_id, display_name)
      values (${member.id}, ${telegramChatId}, ${telegramChatId}, ${member.nickname})`
    await db`
      insert into app.max_links
        (user_id, max_user_id, chat_id, display_name)
      values (${member.id}, ${maxUserId}, ${maxUserId + 1}, ${member.nickname})`
    await db`
      insert into app.vk_links
        (user_id, vk_user_id, chat_id, display_name)
      values (${member.id}, ${vkUserId}, ${vkUserId}, ${member.nickname})`
  })

  await signInUi(page, officer.email)
  await expectSignedIn(page)
  await page.goto(`./#/votes/${voteId}`)
  await page.getByRole('link', { name: 'Подготовить рассылку' }).click()
  await expect(page.getByLabel('Текст рассылки')).toHaveValue(/кнопкой ниже/)
  await page.getByRole('button', { name: 'Отправить анонс' }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(
    dialog.getByText(/голосования придёт с кнопками вариантов ответа/),
  ).toBeVisible()
  await dialog.getByRole('button', { name: 'Отправить', exact: true }).click()
  await expect(page.getByText(/^Отправлено —/)).toBeVisible()

  const telegramMessage = await waitForCall(
    telegramChatId,
    (call) =>
      (call.method === 'sendMessage' || call.method === 'sendPhoto') &&
      (call.params.text ?? call.params.caption ?? '').includes(title),
  )
  const telegramButtons =
    telegramMessage.params.reply_markup!.inline_keyboard.flat()
  expect(telegramButtons.map((button) => button.text)).toEqual([
    'За',
    expect.stringMatching(/^2\. Большин/),
  ])
  await sendUpdate(
    pressUpdate(
      telegramChatId,
      telegramMessage.messageId!,
      telegramButtons[0]!.callback_data,
    ),
  )
  await waitForCall(
    telegramChatId,
    (call) =>
      call.method ===
        (telegramMessage.method === 'sendPhoto'
          ? 'editMessageCaption'
          : 'editMessageText') &&
      call.params.message_id === telegramMessage.messageId &&
      (call.params.text ?? call.params.caption ?? '').includes('Ваш голос: За'),
  )

  const maxMessage = await waitForMaxCall(
    maxUserId,
    (call) =>
      call.method === 'POST /messages' &&
      (call.body.text ?? '').includes(title),
  )
  const maxButtons = maxMessage.body.attachments![0]!.payload.buttons.flat()
  await sendMaxUpdate(
    maxPress(maxUserId, maxMessage.messageId!, maxButtons[1]!.payload),
  )
  await waitForMaxCall(
    maxUserId,
    (call) =>
      call.method === 'PUT /messages' &&
      call.query.message_id === maxMessage.messageId &&
      (call.body.text ?? '').includes(`Ваш голос: ${longOption}`),
  )

  const vkMessage = await waitForVkCall(
    vkUserId,
    (call) =>
      call.method === 'messages.send' &&
      (call.params.message ?? '').includes(title),
  )
  const vkKeyboard = JSON.parse(vkMessage.params.keyboard!) as {
    buttons: { action: { label: string; payload: string } }[][]
  }
  const vkButtons = vkKeyboard.buttons.flat()
  await sendVkEvent(
    'message_event',
    vkPress(vkUserId, vkMessage.messageId!, vkButtons[0]!.action.payload),
  )
  await waitForVkCall(
    vkUserId,
    (call) =>
      call.method === 'messages.edit' &&
      call.params.cmid === String(vkMessage.messageId) &&
      (call.params.message ?? '').includes('Ваш голос: За'),
  )

  const memberPage = await signedInPage(browser, member.email)
  await memberPage.goto(`./#/votes/${voteId}`)
  await expect(memberPage.getByText('Ваше решение: За')).toBeVisible()
  await memberPage.context().close()
  expect(
    (await callsFor(telegramChatId)).filter(
      (call) =>
        (call.method === 'sendMessage' || call.method === 'sendPhoto') &&
        (call.params.text ?? call.params.caption ?? '').includes(title),
    ),
  ).toHaveLength(1)
})
