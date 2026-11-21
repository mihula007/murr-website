import { randomBytes, randomInt } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { hasHorizontalScroll, skipSplash } from './helpers'
import {
  accessToken,
  callApi,
  createMember,
  expectSignedIn,
  signInUi,
  sql,
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
  await page.getByRole('button', { name: 'Сохранить черновик' }).click()
  await expect(
    page.getByText('Сохранено как черновик, не отправлено'),
  ).toBeVisible()
  const draft = page.getByRole('listitem').filter({ hasText: text }).first()
  await expect(draft).toBeVisible()
  await expect(draft.getByText('Черновик', { exact: true })).toBeVisible()
  await expect(draft.getByText('Telegram', { exact: true })).toBeVisible()
  await expect(page.getByText(/^Отправлено/)).toHaveCount(0)
  expect(await hasHorizontalScroll(page)).toBe(false)
}

test('анонс постоянного события: картинка и лимит текста 880 (TGM-28)', async ({
  page,
}) => {
  const officer = await createMember('officer')
  const token = await accessToken(officer.email)
  expect((await callApi('events/ensure-weekly', token)).status).toBe(200)
  const [weekly] = await sql(
    (db) => db<{ id: string }[]>`
      select id from app.events
      where recurring_preset = 'tv_sun_20' and closed_at is null
      order by starts_at desc limit 1`,
  )
  const eventId = weekly!.id

  await signInUi(page, officer.email)
  await expectSignedIn(page)
  await page.goto(`./#/broadcast?source=event&id=${eventId}`)
  const body = page.getByLabel('Текст рассылки')
  await expect(body).toHaveValue(/ТВ/)
  await expect(
    page.getByText(/с картинкой события, поэтому текст — не длиннее 880/),
  ).toBeVisible()

  await body.fill('x'.repeat(881))
  await page.getByRole('button', { name: 'Сохранить черновик' }).click()
  await expect(page.getByText('Слишком длинное значение')).toBeVisible()
  await expect(
    page.getByText('Сохранено как черновик, не отправлено'),
  ).toHaveCount(0)

  // Сервер тоже не отправляет длинный текст.
  const send = await callApi('broadcasts/send', token, {
    body: 'x'.repeat(881),
    eventId,
    channels: ['telegram'],
  })
  expect(send.status).toBe(422)
  expect(await hasHorizontalScroll(page)).toBe(false)
})

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
  await page.getByRole('button', { name: /^Управление событием/ }).click()
  await page.getByRole('menuitem', { name: 'Подготовить рассылку' }).click()
  await expect(page.getByLabel('Тема (необязательно)')).toHaveValue(title)
  await expect(page.getByLabel('Текст рассылки')).toHaveValue(/Тип: PvE/)
  // Подключены Telegram, ВКонтакте и MAX (Q-99, Q-102).
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
    .getByRole('link', { name: 'Рассылка' })
    .click()
  await expect(page.getByText(/Сейчас в группе: 1./)).toBeVisible()
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
        channels: ['telegram'],
      })
    ).status,
  ).toBe(403)
})

test('BRC-15: subscription list loads the next cursor page without duplicates', async ({
  page,
}) => {
  const officer = await createMember('officer')
  const prefix = randomBytes(2).toString('hex')
  await sql(async (db) => {
    await db`
      with candidates as (
        select gen_random_uuid() as id, n
        from generate_series(1, 55) as n
      ), users as (
        insert into auth.users (id, instance_id, aud, role, email)
        select id, '00000000-0000-0000-0000-000000000000',
          'authenticated', 'authenticated', id::text || '@example.test'
        from candidates
        returning id
      )
      insert into app.profiles
        (id, display_name, game_nickname, class_id, access_role)
      select users.id, 'Тест', ${prefix} || lpad(candidates.n::text, 5, '0'),
        1, 'member'
      from users join candidates using (id)`
  })

  await signInUi(page, officer.email)
  await expectSignedIn(page)

  const isSubscriptionsPage = (response: {
    url: () => string
    request: () => { postData: () => string | null }
  }) => response.url().includes('/functions/v1/api/broadcasts/subscriptions')
  const firstResponse = page.waitForResponse((response) => {
    if (!isSubscriptionsPage(response)) {
      return false
    }
    const request = JSON.parse(response.request().postData() ?? '{}') as {
      cursor?: string | null
      search?: string
    }
    return (
      (request.cursor === null || request.cursor === undefined) &&
      request.search === prefix
    )
  })
  await page.goto('./#/broadcast?tab=subscriptions')
  await expect(page.getByRole('tab', { name: 'Подписки' })).toHaveAttribute(
    'data-state',
    'active',
  )
  await page.getByLabel('Поиск по нику').fill(prefix)
  const first = (await (await firstResponse).json()) as {
    items: { id: string; gameNickname: string }[]
    nextCursor: string | null
  }
  expect(first.items).toHaveLength(50)
  expect(
    first.items.every((item) => item.gameNickname.startsWith(prefix)),
  ).toBe(true)
  expect(first.nextCursor).toBeTruthy()
  const subscriptions = page.getByRole('region', {
    name: 'Прокручиваемый список: Участники и привязки мессенджеров',
  })
  await expect(subscriptions).toHaveAttribute('data-viewport-rows', '15')
  expect(
    await subscriptions.evaluate(
      (element) => element.scrollHeight > element.clientHeight,
    ),
  ).toBe(true)

  const secondResponse = page.waitForResponse((response) => {
    if (!isSubscriptionsPage(response)) {
      return false
    }
    const body = JSON.parse(response.request().postData() ?? '{}') as {
      cursor?: string | null
      search?: string
    }
    return body.cursor === first.nextCursor && body.search === prefix
  })
  await subscriptions.scrollIntoViewIfNeeded()
  await subscriptions.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  const second = (await (await secondResponse).json()) as {
    items: { id: string; gameNickname: string }[]
    nextCursor: string | null
  }
  expect(second.items).toHaveLength(5)
  expect(second.nextCursor).toBeNull()
  expect(
    new Set([...first.items, ...second.items].map((item) => item.id)).size,
  ).toBe(first.items.length + second.items.length)

  const lastNickname = second.items.at(-1)?.gameNickname
  expect(lastNickname).toBeTruthy()
  await subscriptions.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await expect(page.getByText(lastNickname as string)).toBeVisible()
})

test('BRC-15: subscription tab shows messenger links to managers only', async ({
  page,
}) => {
  const [officer, linked, unlinked] = await Promise.all([
    createMember('officer'),
    createMember('member'),
    createMember('member'),
  ])
  const telegramId = randomInt(1_000_000, 2_000_000_000)
  const vkId = randomInt(1_000_000, 2_000_000_000)
  const maxId = randomInt(1_000_000, 2_000_000_000)
  await sql(async (db) => {
    await db`
      insert into app.telegram_links
        (user_id, telegram_user_id, chat_id, display_name)
      values (${linked.id}, ${telegramId}, ${telegramId}, ${linked.nickname})`
    await db`
      insert into app.vk_links
        (user_id, vk_user_id, chat_id, display_name, blocked_at)
      values (${linked.id}, ${vkId}, ${vkId}, ${linked.nickname}, now())`
    await db`
      insert into app.max_links
        (user_id, max_user_id, chat_id, display_name)
      values (${linked.id}, ${maxId}, ${maxId}, ${linked.nickname})`
  })

  await signInUi(page, officer.email)
  await expectSignedIn(page)
  await page.goto(
    `./#/broadcast?tab=subscriptions&q=${encodeURIComponent(linked.nickname)}`,
  )
  await expect(page.getByRole('tab', { name: 'Подписки' })).toHaveAttribute(
    'data-state',
    'active',
  )
  await expect(page.getByText(linked.nickname)).toBeVisible()
  await expect(
    page.getByRole('group', { name: 'Telegram: привязан' }),
  ).toBeVisible()
  await expect(
    page.getByRole('group', { name: 'ВКонтакте: сообщения недоступны' }),
  ).toBeVisible()
  await expect(page.getByRole('group', { name: 'MAX: привязан' })).toBeVisible()

  await page.getByLabel('Поиск по нику').fill(unlinked.nickname)
  await expect(page.getByText(unlinked.nickname)).toBeVisible()
  await page.setViewportSize({ width: 375, height: 812 })
  expect(await hasHorizontalScroll(page)).toBe(false)

  const memberToken = await accessToken(linked.email)
  expect(
    (await callApi('broadcasts/subscriptions', memberToken, { cursor: null }))
      .status,
  ).toBe(403)
})

test('BRC-16: excludes a recipient from one announcement only', async ({
  page,
}) => {
  const [officer, excluded, included] = await Promise.all([
    createMember('officer'),
    createMember('member'),
    createMember('member'),
  ])
  const telegramIds = [
    randomInt(1_000_000, 2_000_000_000),
    randomInt(1_000_000, 2_000_000_000),
  ]
  await sql(async (db) => {
    for (const [member, telegramId] of [
      [excluded, telegramIds[0]!],
      [included, telegramIds[1]!],
    ] as const) {
      await db`
        insert into app.telegram_links
          (user_id, telegram_user_id, chat_id, display_name)
        values (${member.id}, ${telegramId}, ${telegramId}, ${member.nickname})`
    }
  })

  await signInUi(page, officer.email)
  await expectSignedIn(page)
  await page.goto('./#/broadcast')
  await page.getByLabel('Тема (необязательно)').fill('Проверка исключения')
  await page
    .getByLabel('Текст рассылки')
    .fill('Сообщение для оставшегося участника')
  await page.getByRole('checkbox', { name: 'ВКонтакте' }).uncheck()
  await page.getByRole('checkbox', { name: 'MAX' }).uncheck()
  await page.getByLabel('Поиск по нику').fill(excluded.nickname)
  const recipientsResponse = await page.waitForResponse((response) =>
    response.url().includes('/broadcasts/recipients'),
  )
  expect(recipientsResponse.ok()).toBe(true)
  const recipientSummary = page.getByText(/^Получателей по каналам:/)
  await expect(recipientSummary).toBeVisible()
  const initialTelegramCountText = (
    await recipientSummary.textContent()
  )?.match(/Telegram: (\d+)/)?.[1]
  expect(initialTelegramCountText).toBeDefined()
  const initialTelegramCount = Number(initialTelegramCountText)
  await page
    .getByRole('checkbox', { name: `Получит: ${excluded.nickname}` })
    .uncheck()
  await expect(recipientSummary).toHaveText(
    `Получателей по каналам: Telegram: ${initialTelegramCount - 1}`,
  )

  let sendBody: Record<string, unknown> | null = null
  await page.route('**/broadcasts/send', async (route) => {
    sendBody = route.request().postDataJSON() as Record<string, unknown>
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        recipients: 1,
        sent: 1,
        failed: 0,
        channels: { telegram: { recipients: 1, sent: 1, failed: 0 } },
      }),
    })
  })
  await page.getByRole('button', { name: 'Отправить анонс' }).click()
  await page.getByRole('button', { name: 'Отправить', exact: true }).click()
  await expect
    .poll(() => sendBody)
    .toMatchObject({
      excludedUserIds: [excluded.id],
      channels: ['telegram'],
    })
  expect(sendBody).not.toHaveProperty('recipientNicknames')
  await expect(page.getByText('Отправлено — Telegram: 1')).toBeVisible()
  await page.getByLabel('Поиск по нику').fill(included.nickname)
  await expect(
    page.getByRole('checkbox', { name: `Получит: ${included.nickname}` }),
  ).toBeChecked()
})
