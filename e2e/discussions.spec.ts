import { expect, test, type Browser, type Page } from '@playwright/test'
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
  'Сценарии обсуждений проверяются на корневом пути',
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

function moscowDate(days = 0) {
  return new Date(Date.now() + (3 + 24 * days) * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
}

type Person = Awaited<ReturnType<typeof createMember>>

async function createEvent(officer: Person) {
  const title = `E2E обсуждение ${Date.now()}`
  const created = await callApi(
    'events/create',
    await accessToken(officer.email),
    {
      title,
      type: 'pvp',
      date: moscowDate(3),
      time: '20:00',
      description: 'Проверка обсуждения',
    },
  )
  expect(created.status).toBe(200)
  return { id: created.body.id as string, title }
}

async function createVote(officer: Person) {
  const title = `E2E голосование ${Date.now()}`
  const created = await callApi(
    'votes/create',
    await accessToken(officer.email),
    { title, context: '', options: ['Да', 'Нет'] },
  )
  expect(created.status).toBe(200)
  return { id: created.body.id as string, title }
}

/** Чат события: колонкой на широком экране, вкладкой на узком. */
async function openEventDiscussion(page: Page, id: string, isMobile: boolean) {
  await page.goto(`./#/events/${id}`)
  if (isMobile) {
    await page.getByRole('tab', { name: /Обсуждение/ }).click()
  }
  return page.getByRole('list', { name: 'Сообщения обсуждения' })
}

const messageOf = (page: Page, author: string) =>
  page.getByRole('article', { name: new RegExp(`^Сообщение ${author},`) })

test('обсуждение события: ответ, упоминание, реакции, правка и закрытие', async ({
  page,
  browser,
  isMobile,
}) => {
  const [officer, member, mentioned] = await Promise.all([
    createMember('officer'),
    createMember('member'),
    createMember('member'),
  ])
  const event = await createEvent(officer)

  // Участник пишет первым; Ctrl+Enter отправляет, пустое не уходит.
  await signInUi(page, member.email)
  await expectSignedIn(page)
  await openEventDiscussion(page, event.id, isMobile)
  await expect(page.getByText('Сообщений пока нет.')).toBeVisible()
  const field = page.getByLabel('Сообщение', { exact: true })
  await field.fill('   ')
  await page.getByRole('button', { name: 'Отправить' }).click()
  await expect(page.getByText('Заполните поле')).toBeVisible()
  await field.fill('Кто идёт на осаду?\nСбор в 19:50')
  await field.press('ControlOrMeta+Enter')
  await expect(messageOf(page, member.nickname)).toContainText('Сбор в 19:50')
  await expect(field).toHaveValue('')
  expect(await hasHorizontalScroll(page)).toBe(false)

  // Правка своего сообщения в течение 5 минут.
  await messageOf(page, member.nickname)
    .getByRole('button', { name: /Действия с сообщением/ })
    .click()
  await page.getByRole('menuitem', { name: 'Изменить' }).click()
  const edit = page.getByLabel('Текст сообщения')
  await edit.fill('Кто идёт на осаду? Сбор в 19:45')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(messageOf(page, member.nickname)).toContainText('19:45')
  await expect(messageOf(page, member.nickname)).toContainText('изменено')

  // Офицер отвечает с цитатой и упоминает третьего участника.
  const officerPage = await signedInPage(browser, officer.email)
  await openEventDiscussion(officerPage, event.id, isMobile)
  const original = messageOf(officerPage, member.nickname)
  await original.getByRole('button', { name: /Действия с сообщением/ }).click()
  await expect(
    officerPage.getByRole('menuitem', { name: 'Изменить' }),
  ).toHaveCount(0)
  await officerPage.getByRole('menuitem', { name: 'Ответить' }).click()
  await expect(officerPage.getByText(`Ответ ${member.nickname}`)).toBeVisible()
  await officerPage
    .getByLabel('Сообщение', { exact: true })
    .fill(`Иду. @${mentioned.nickname}, ты с нами?`)
  await officerPage.getByRole('button', { name: 'Отправить' }).click()
  const reply = messageOf(officerPage, officer.nickname)
  await expect(reply).toContainText('Офицер')
  await expect(reply.locator('blockquote')).toContainText('19:45')

  const notifications = await sql(
    (db) => db<{ recipient: string; kind: string }[]>`
      select recipient_id as recipient, kind from app.user_notifications
      where kind like 'discussion_%' and target_id = ${event.id}
      order by kind`,
  )
  expect(notifications).toEqual([
    { recipient: mentioned.id, kind: 'discussion_mention' },
    { recipient: member.id, kind: 'discussion_reply' },
  ])

  // Участник видит ответ после обновления и ставит две реакции, снимает одну.
  await page.reload()
  await openEventDiscussion(page, event.id, isMobile)
  const officerMessage = messageOf(page, officer.nickname)
  await expect(officerMessage).toContainText(`@${mentioned.nickname}`)
  for (const emoji of ['🔥', '🤡']) {
    await officerMessage
      .getByRole('button', { name: /Действия с сообщением/ })
      .click()
    await page.getByRole('menuitem', { name: `Реакция ${emoji}` }).click()
    await expect(
      officerMessage.getByRole('button', { name: `${emoji} 1` }),
    ).toBeVisible()
  }
  await officerMessage.getByRole('button', { name: '🤡 1' }).click()
  await expect(officerMessage.getByRole('button', { name: /🤡/ })).toHaveCount(
    0,
  )
  await expect(
    officerMessage.getByRole('button', { name: '🔥 1' }),
  ).toHaveAttribute('aria-pressed', 'true')

  // Автор видит, кто прочитал его сообщение.
  await officerPage.reload()
  await openEventDiscussion(officerPage, event.id, isMobile)
  await messageOf(officerPage, officer.nickname)
    .getByRole('button', { name: /Действия с сообщением/ })
    .click()
  await officerPage.getByRole('menuitem', { name: 'Кто прочитал' }).click()
  const readers = officerPage.getByRole('dialog', { name: 'Кто прочитал' })
  await expect(
    readers.getByRole('listitem').filter({ hasText: member.nickname }),
  ).toBeVisible()
  await officerPage.keyboard.press('Escape')

  // Окно участника открыто, офицер закрывает событие: запись отклоняется,
  // история остаётся.
  const closed = await callApi(
    'events/close',
    await accessToken(officer.email),
    { id: event.id },
  )
  expect(closed.status).toBe(200)
  await page.getByLabel('Сообщение', { exact: true }).fill('Уже после закрытия')
  await page.getByRole('button', { name: 'Отправить' }).click()
  await expect(page.getByText('Обсуждение закрыто.')).toBeVisible()
  await page.reload()
  await openEventDiscussion(page, event.id, isMobile)
  await expect(
    page.getByText('Обсуждение закрыто: история доступна для чтения.'),
  ).toBeVisible()
  await expect(messageOf(page, officer.nickname)).toBeVisible()
  await expect(page.getByLabel('Сообщение', { exact: true })).toHaveCount(0)
})

test('обсуждение голосования: отдельная ветка, окно и длинная история', async ({
  page,
}) => {
  const [officer, member] = await Promise.all([
    createMember('officer'),
    createMember('member'),
  ])
  const vote = await createVote(officer)
  const event = await createEvent(officer)
  await callApi('discussions/send', await accessToken(officer.email), {
    parent: 'event',
    parentId: event.id,
    body: 'Только в событии',
  })

  // 60 сообщений — больше страницы (50): старые подгружаются вверх (Q-62).
  await sql(
    (db) => db`
      with thread as (
        insert into app.discussion_threads (vote_id) values (${vote.id})
        returning id
      )
      insert into app.discussion_messages
        (thread_id, author_id, body, created_at, changed_at)
      select thread.id, ${officer.id}, 'История ' || n,
        date_trunc('milliseconds', now()) - (61 - n) * interval '1 minute',
        date_trunc('milliseconds', now()) - (61 - n) * interval '1 minute'
      from thread, generate_series(1, 60) as n`,
  )

  await signInUi(page, member.email)
  await expectSignedIn(page)
  await page.goto(`./#/votes/${vote.id}`)
  const open = page.getByRole('button', { name: 'Обсуждение (60)' })
  await open.click()
  const dialog = page.getByRole('dialog', { name: 'Обсуждение' })
  await expect(dialog.getByText('История 60', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Только в событии')).toHaveCount(0)
  expect(await hasHorizontalScroll(page)).toBe(false)

  const list = dialog.getByRole('list', { name: 'Сообщения обсуждения' })
  const first = dialog.getByText('История 1', { exact: true })
  for (let step = 0; step < 40 && (await first.count()) === 0; step += 1) {
    await list.evaluate((element) => {
      element.parentElement?.scrollTo({ top: 0 })
    })
    await page.waitForTimeout(150)
  }
  await first.scrollIntoViewIfNeeded()
  await expect(first).toBeVisible()

  // Escape закрывает окно, фокус возвращается на кнопку (DSC-15).
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(open).toBeFocused()

  // Чтец не получает ветку даже прямым вызовом.
  const reader = await createMember('reader')
  const denied = await callApi(
    'discussions/list',
    await accessToken(reader.email),
    { parent: 'vote', parentId: vote.id },
  )
  expect(denied.status).toBe(403)
})

test('E2E-04: участник обсуждает опубликованный материал', async ({
  page,
  isMobile,
}) => {
  const [officer, member] = await Promise.all([
    createMember('officer'),
    createMember('member'),
  ])
  const title = `E2E материал ${Date.now()}`
  const saved = await callApi(
    'publications/save',
    await accessToken(officer.email),
    {
      status: 'published',
      category: 'guide',
      title,
      summary: null,
      content: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Текст' }] },
        ],
      },
      showAuthor: true,
      discussionEnabled: true,
      attachments: [],
    },
  )
  expect(saved.status).toBe(200)

  await signInUi(page, member.email)
  await expectSignedIn(page)
  await page.goto(`./#/publications/${saved.body.id as string}`)
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  await page.getByRole('button', { name: 'Обсуждение (0)' }).click()
  const dialog = page.getByRole('dialog', { name: 'Обсуждение' })
  await dialog.getByLabel('Сообщение', { exact: true }).fill('Полезный гайд')
  await dialog.getByRole('button', { name: 'Отправить' }).click()
  await expect(messageOf(page, member.nickname)).toContainText('Полезный гайд')
  // Клик вне окна закрывает его (на телефоне окно во весь экран — кнопка
  // «Закрыть»); счётчик на кнопке обновился.
  if (isMobile) {
    await dialog.getByRole('button', { name: 'Закрыть' }).click()
  } else {
    await page.mouse.click(5, 5)
  }
  await expect(dialog).toBeHidden()
  await expect(
    page.getByRole('button', { name: 'Обсуждение (1)' }),
  ).toBeVisible()
})
