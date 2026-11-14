import { readFile } from 'node:fs/promises'
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
  'Сценарии групп проверяются на корневом пути',
)

test.beforeEach(async ({ page }) => {
  // Несколько пользователей, сессий и вызовов функции на слабой машине.
  test.setTimeout(240_000)
  await skipSplash(page)
})

/** Дата по Москве через `days` дней, `YYYY-MM-DD` (Q-44). */
function moscowDate(days = 0) {
  return new Date(Date.now() + (3 + 24 * days) * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
}

type Person = Awaited<ReturnType<typeof createMember>>

/** Событие офицера через API и ответы участников (EVT-04). */
async function eventWithAnswers(
  officer: Person,
  answers: [Person, 'yes' | 'maybe' | 'no'][],
) {
  const title = `E2E группы ${Date.now()}`
  const created = await callApi(
    'events/create',
    await accessToken(officer.email),
    {
      title,
      type: 'pve',
      date: moscowDate(3),
      time: '20:00',
      description: 'Проверка групп и учёта',
    },
  )
  expect(created.status).toBe(200)
  const id = created.body.id as string
  for (const [person, answer] of answers) {
    const response = await callApi(
      'events/respond',
      await accessToken(person.email),
      { eventId: id, answer },
    )
    expect(response.status).toBe(200)
  }
  return { id, title }
}

/** Перенос через меню строки — основной путь на узком экране (Q-51). */
async function moveToGroup(page: Page, nickname: string, group: string) {
  await page.getByRole('button', { name: `Действия: ${nickname}` }).click()
  await page.getByRole('menuitem', { name: group }).click()
  await expect(
    page.getByRole('list', { name: `Состав «${group}»` }),
  ).toContainText(nickname)
}

async function createGroup(page: Page, name: string) {
  await page.getByRole('button', { name: 'Создать группу' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Название группы').fill(name)
  await dialog.getByRole('button', { name: 'Создать' }).click()
  await expect(dialog).toBeHidden()
  await expect(
    page.getByRole('heading', { name: new RegExp(name) }),
  ).toBeVisible()
}

test('E2E-03: группы, лидер, закрытие, учёт активности и Excel', async ({
  page,
}) => {
  const officer = await createMember('officer')
  const [anna, boris, vera, gone] = await Promise.all([
    createMember('member'),
    createMember('member'),
    createMember('member'),
    createMember('member'),
  ])
  const event = await eventWithAnswers(officer, [
    [anna, 'yes'],
    [boris, 'yes'],
    [vera, 'maybe'],
    [gone, 'yes'],
  ])

  await signInUi(page, officer.email)
  await expectSignedIn(page)
  await page.goto(`./#/events/${event.id}`)
  await createGroup(page, 'Пати 1')
  await moveToGroup(page, anna.nickname, 'Пати 1')
  await moveToGroup(page, gone.nickname, 'Пати 1')
  // Не ответивший тоже назначается (GRP-05): Борис ответил, но в группу не идёт.
  await page.getByRole('combobox', { name: 'Лидер группы «Пати 1»' }).click()
  await page.getByRole('option', { name: anna.nickname }).click()
  await expect(page.getByText(`${anna.nickname} — Пати лидер`)).toBeVisible()
  expect(await hasHorizontalScroll(page)).toBe(false)

  // Закрытие (EVT-08): подтверждение, затем только чтение.
  await page.getByRole('button', { name: 'Завершить событие' }).click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Завершить' })
    .click()
  await expect(page.getByText('Событие закрыто')).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Создать группу' }),
  ).toHaveCount(0)
  await expect(page.getByRole('list', { name: 'Посетили' })).toContainText(
    anna.nickname,
  )

  // Чтец сохраняет историю, удалённый пользователь исчезает (ACT-17, Q-53).
  await sql(
    (db) =>
      db`update app.profiles set access_role = 'reader' where id = ${boris.id}`,
  )
  await sql((db) => db`delete from app.profiles where id = ${gone.id}`)

  await page.goto(
    `./#/activity?view=history&q=${encodeURIComponent(event.title)}`,
  )
  const history = page.getByRole('table', { name: 'История событий' })
  await expect(history).toBeVisible()
  // Поиск истории — на сервере (ник или мероприятие): новый ник даёт одну
  // строку, прокрутка виртуализированного списка не нужна.
  const historyRow = async (nickname: string) => {
    await page.getByLabel('Поиск', { exact: true }).fill(nickname)
    await expect(page).toHaveURL(new RegExp(`q=${nickname}`))
    const row = history.getByRole('row').filter({ hasText: nickname })
    await expect(row).toHaveCount(1)
    return row
  }
  const annaRow = await historyRow(anna.nickname)
  await expect(annaRow).toContainText('Пати 1')
  await expect(annaRow).toContainText('Посетил')
  const borisRow = await historyRow(boris.nickname)
  await expect(borisRow).toContainText('Чтец')
  await expect(borisRow).toContainText('Не посетил')
  const veraRow = await historyRow(vera.nickname)
  await expect(veraRow).toContainText('Не посетил')
  await page.getByLabel('Поиск', { exact: true }).fill(gone.nickname)
  await expect(page).toHaveURL(new RegExp(`q=${gone.nickname}`))
  await expect(page.getByText('Нет записей')).toBeVisible()
  expect(await hasHorizontalScroll(page)).toBe(false)

  // «По мероприятию» (ACT-07): поиск — по названию события.
  await page.getByLabel('Поиск', { exact: true }).fill(event.title)
  await expect(page).toHaveURL(/q=E2E/)
  await page.getByRole('tab', { name: 'По событию' }).click()
  await page.getByRole('button', { name: new RegExp(event.title) }).click()
  await expect(
    page.getByRole('heading', { name: new RegExp(event.title) }),
  ).toBeVisible()
  await expect(page.getByText(/^1\s*посетили$/)).toBeVisible()

  // Excel с активным поиском (ACT-11, Q-18): один файл .xlsx.
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: /Выгрузить Excel/ }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^MurrClan_activity_.*\.xlsx$/)
  const bytes = await readFile((await file.path())!)
  // Формат .xlsx — ZIP без сжатия: XML листов читается как текст.
  expect(bytes.subarray(0, 2).toString()).toBe('PK')
  const text = bytes.toString('utf8')
  expect(text).toContain('name="Рейтинг"')
  expect(text).toContain('name="История событий"')
  expect(text).toContain(event.title)
  expect(text).toContain(anna.nickname)
  expect(text).not.toContain(gone.nickname)

  // Рейтинг: участник с лидерством; чтеца нет (Q-53).
  await page.goto('./#/rating')
  const rating = page.getByRole('table', { name: 'Рейтинг посещения' })
  await page.getByLabel('Поиск по участнику').fill(anna.nickname)
  await expect(
    rating.getByRole('row').filter({ hasText: anna.nickname }),
  ).toContainText('100%')
  await page.getByLabel('Поиск по участнику').fill(boris.nickname)
  await expect(rating.getByRole('row')).toHaveCount(0)
})

test('перетаскивание участника в группу и обратно в список (GRP-04)', async ({
  page,
}) => {
  test.skip(
    test.info().project.name !== 'chromium',
    'На узком экране основной путь — меню строки',
  )
  const officer = await createMember('officer')
  const member = await createMember('member')
  const event = await eventWithAnswers(officer, [[member, 'yes']])
  // Список и группа помещаются на экран: перетаскивание идёт мышью по окну.
  await page.setViewportSize({ width: 1280, height: 1400 })
  await signInUi(page, officer.email)
  await expectSignedIn(page)
  await page.goto(`./#/events/${event.id}`)
  await createGroup(page, 'Танки')

  const drag = async (from: string, to: string) => {
    const handle = page.getByRole('button', { name: `Перетащить ${from}` })
    await handle.scrollIntoViewIfNeeded()
    const source = (await handle.boundingBox())!
    const target = (await page
      .getByText(to, { exact: false })
      .first()
      .boundingBox())!
    await page.mouse.move(
      source.x + source.width / 2,
      source.y + source.height / 2,
    )
    await page.mouse.down()
    await page.mouse.move(target.x + 20, target.y + target.height / 2, {
      steps: 12,
    })
    await page.mouse.up()
  }

  await drag(member.nickname, 'Перетащите участников сюда')
  await expect(
    page.getByRole('list', { name: 'Состав «Танки»' }),
  ).toContainText(member.nickname)
  await drag(member.nickname, 'Назначенные в группы скрываются')
  await expect(page.getByRole('list', { name: 'Состав «Танки»' })).toHaveCount(
    0,
  )
  await expect(page.getByRole('list', { name: 'Придут' })).toContainText(
    member.nickname,
  )
})

test('прямые запрещённые вызовы групп и учёта отклоняются', async () => {
  test.skip(
    test.info().project.name !== 'chromium',
    'Прямые вызовы API не зависят от устройства',
  )
  const [member, author, other] = await Promise.all([
    createMember('member'),
    createMember('member'),
    createMember('officer'),
  ])
  const officer = await createMember('officer')
  const event = await eventWithAnswers(officer, [[author, 'yes']])
  const [memberToken, otherToken] = await Promise.all([
    accessToken(member.email),
    accessToken(other.email),
  ])
  expect(
    (
      await callApi('groups/create', memberToken, {
        eventId: event.id,
        name: 'Пати',
      })
    ).status,
  ).toBe(403)
  expect(
    (
      await callApi('groups/move', memberToken, {
        eventId: event.id,
        userId: author.id,
        groupId: null,
      })
    ).status,
  ).toBe(403)
  expect(
    (await callApi('events/close', memberToken, { id: event.id })).status,
  ).toBe(403)
  // Чужое обычное событие офицер не закрывает (EVT-07).
  expect(
    (await callApi('events/close', otherToken, { id: event.id })).status,
  ).toBe(403)
  // Учёт — только офицер и администратор (Q-25), рейтинг — всем внутренним.
  expect((await callApi('activity/history', memberToken)).status).toBe(403)
  expect((await callApi('activity/summary', memberToken)).status).toBe(403)
  expect((await callApi('activity/rating', memberToken)).status).toBe(200)
  // Повторное закрытие не начисляет посещение второй раз (EVT-08).
  const officerToken = await accessToken(officer.email)
  expect(
    (await callApi('events/close', officerToken, { id: event.id })).status,
  ).toBe(200)
  expect(
    (await callApi('events/close', officerToken, { id: event.id })).status,
  ).toBe(409)
})
