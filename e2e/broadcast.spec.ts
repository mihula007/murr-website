import { expect, test, type Page } from '@playwright/test'
import { hasHorizontalScroll, skipSplash } from './helpers'
import {
  accessToken,
  callApi,
  createMember,
  expectSignedIn,
  signInUi,
} from './supabase'

test.skip(
  ({ baseURL }) => Boolean(baseURL?.includes('/repository/')),
  'Сценарии рассылок проверяются на корневом пути',
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

const prepare = (page: Page) =>
  page.getByRole('link', { name: 'Подготовить рассылку' })

/** Черновик сохранён, а интерфейс нигде не говорит «отправлено» (BRC-13). */
async function saveAndExpectDraft(page: Page, text: RegExp) {
  await page.getByRole('checkbox', { name: 'MAX' }).uncheck()
  await expect(
    page.getByRole('button', { name: 'Отправить рассылку' }),
  ).toBeDisabled()
  await page.getByRole('button', { name: 'Сохранить черновик' }).click()
  await expect(
    page.getByText('Сохранено как черновик, не отправлено'),
  ).toBeVisible()
  const draft = page.getByRole('listitem').filter({ hasText: text }).first()
  await expect(draft).toBeVisible()
  await expect(
    draft.getByText('Черновик · отправка после подключения'),
  ).toBeVisible()
  await expect(draft.getByText('MAX', { exact: true })).toHaveCount(0)
  await expect(page.getByText(/^Отправлено/)).toHaveCount(0)
  expect(await hasHorizontalScroll(page)).toBe(false)
}

test('E2E-07: подготовка рассылки из события, голосования и группы', async ({
  page,
}) => {
  const [officer, member] = await Promise.all([
    createMember('officer'),
    createMember('member'),
  ])
  const token = await accessToken(officer.email)
  const title = `E2E рассылка ${Date.now()}`
  const event = await callApi('events/create', token, {
    title,
    type: 'pve',
    date: moscowDate(3),
    time: '20:00',
    description: 'Сбор у портала',
  })
  expect(event.status).toBe(200)
  const eventId = event.body.id as string
  const group = await callApi('groups/create', token, {
    eventId,
    name: 'Пати 1',
  })
  const groupId = (group.body.groups as { id: string }[])[0]!.id
  expect(
    (
      await callApi('groups/move', token, {
        eventId,
        userId: member.id,
        groupId,
      })
    ).status,
  ).toBe(200)
  const vote = await callApi('votes/create', token, {
    title: `${title} голосование`,
    context: 'Выбираем подземелье',
    options: ['Башня', 'Пещера'],
  })
  expect(vote.status).toBe(200)

  await signInUi(page, officer.email)
  await expectSignedIn(page)

  // Из события (BRC-02).
  await page.goto(`./#/events/${eventId}`)
  await prepare(page).first().click()
  await expect(page.getByLabel('Тема (необязательно)')).toHaveValue(title)
  await expect(page.getByLabel('Текст рассылки')).toHaveValue(/Тип: PvE/)
  for (const channel of ['Telegram', 'ВКонтакте', 'MAX']) {
    await expect(page.getByRole('checkbox', { name: channel })).toBeChecked()
  }
  await saveAndExpectDraft(page, new RegExp(title))

  // Из голосования (BRC-03).
  await page.goto(`./#/votes/${vote.body.id as string}`)
  await prepare(page).click()
  await expect(page.getByLabel('Текст рассылки')).toHaveValue(
    /Выбираем подземелье/,
  )

  // Из непустой группы (BRC-04).
  await page.goto(`./#/events/${eventId}`)
  await page
    .getByRole('list', { name: 'Состав «Пати 1»' })
    .locator('..')
    .getByRole('link', { name: 'Подготовить рассылку' })
    .click()
  await expect(page.getByText('Получателей в группе: 1.')).toBeVisible()
  await expect(page.getByLabel('Текст рассылки')).toHaveValue(
    new RegExp(`1\\. ${member.nickname}`),
  )
  await saveAndExpectDraft(page, new RegExp(`${title} — Пати 1`))

  // Член клана не готовит рассылки: прямой вызов отклоняется.
  const memberToken = await accessToken(member.email)
  expect(
    (
      await callApi('broadcasts/save-draft', memberToken, {
        body: 'x',
        channels: ['vk'],
      })
    ).status,
  ).toBe(403)
})
