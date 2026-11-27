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
  await expect(page.getByText(`${anna.nickname} — ПЛ`)).toBeVisible()
  expect(await hasHorizontalScroll(page)).toBe(false)

  // Закрытие (EVT-08): подтверждение, затем только чтение.
  await page.getByRole('button', { name: 'Завершить событие' }).click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Завершить' })
    .click()
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
    const row = history
      .getByRole('row')
      .filter({ hasText: event.title })
      .filter({ hasText: new RegExp(`\\b${nickname}\\b`) })
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
  const annaRating = rating.getByRole('row').filter({
    hasText: anna.nickname,
  })
  await expect(annaRating).toContainText('Посетил1')
  await expect(annaRating).toContainText('Пати-лидер1')
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

test('шаблон редактируется, фильтруется по классу и не меняет группы события', async ({
  page,
}) => {
  test.skip(test.info().project.name !== 'chromium', 'Сценарий интерфейса')
  const officer = await createMember('officer')
  const [assigned, free] = await Promise.all([
    createMember('member'),
    createMember('member'),
  ])
  const event = await eventWithAnswers(officer, [[assigned, 'yes']])
  await page.setViewportSize({ width: 1240, height: 900 })
  await signInUi(page, officer.email)
  await expectSignedIn(page)
  await page.goto(`./#/events/${event.id}`)
  await createGroup(page, 'Событийная группа')
  await moveToGroup(page, assigned.nickname, 'Событийная группа')
  const eventGroup = page.getByRole('list', {
    name: 'Состав «Событийная группа»',
  })
  await expect(eventGroup).toContainText(assigned.nickname)
  await expect(eventGroup).not.toContainText(free.nickname)

  await page.getByRole('button', { name: 'Шаблоны групп' }).click()
  await page.getByRole('button', { name: 'Сохранить как шаблон' }).click()
  const editor = page.getByRole('dialog', { name: 'Шаблон групп' })
  await expect(editor.getByLabel('Название шаблона')).toHaveValue(event.title)
  const desktopBox = await editor.boundingBox()
  expect(desktopBox?.width).toBeGreaterThan(1100)
  await expect(
    editor.getByRole('list', {
      name: `Участники группы Событийная группа`,
    }),
  ).toContainText(assigned.nickname)

  await editor
    .getByRole('searchbox', { name: 'Поиск в составе' })
    .fill(free.nickname)
  const classFilter = editor.getByRole('combobox', { name: 'Фильтр по классу' })
  await classFilter.click()
  await page.getByRole('option', { name: 'Оборотень' }).click()
  const freePool = editor.getByRole('list', { name: 'Свободные участники' })
  await expect(freePool).toContainText(free.nickname)
  await expect(freePool).toContainText('ПА')

  await editor.getByLabel('Название шаблона').fill('Шаблон после правки')
  await editor
    .getByRole('button', { name: `Действия: ${free.nickname}` })
    .click()
  await page.getByRole('menuitem', { name: 'Событийная группа' }).click()
  const leaderPicker = editor.getByRole('combobox', {
    name: 'Лидер группы «Событийная группа»',
  })
  await leaderPicker.click()
  await page.getByRole('option', { name: free.nickname }).click()
  await editor.getByRole('button', { name: 'Сохранить шаблон' }).click()

  const library = page.getByRole('dialog', { name: 'Шаблоны групп' })
  await expect(library).toContainText('Шаблон после правки')
  const updatedTemplate = library
    .getByRole('list', { name: 'Шаблоны групп' })
    .getByRole('listitem')
    .filter({ hasText: 'Шаблон после правки' })
    .first()
  await updatedTemplate.getByRole('button', { name: 'Изменить' }).click()
  const editDialog = page.getByRole('dialog', {
    name: 'Редактировать шаблон групп',
  })
  await expect(editDialog.getByLabel('Название шаблона')).toHaveValue(
    'Шаблон после правки',
  )
  await expect(
    editDialog.getByRole('combobox', {
      name: 'Лидер группы «Событийная группа»',
    }),
  ).toHaveText(free.nickname)

  await editDialog.getByRole('button', { name: 'Отмена' }).click()
  await library.getByRole('button', { name: 'Закрыть' }).click()
  await page.setViewportSize({ width: 375, height: 812 })
  await page.getByRole('button', { name: 'Шаблоны групп' }).click()
  const mobileLibrary = page.getByRole('dialog', { name: 'Шаблоны групп' })
  const mobileTemplate = mobileLibrary
    .getByRole('list', { name: 'Шаблоны групп' })
    .getByRole('listitem')
    .filter({ hasText: 'Шаблон после правки' })
    .first()
  await mobileTemplate.getByRole('button', { name: 'Изменить' }).click()
  const mobileEditDialog = page.getByRole('dialog', {
    name: 'Редактировать шаблон групп',
  })
  await expect(mobileEditDialog).toBeVisible()
  expect(await hasHorizontalScroll(page)).toBe(false)
  const mobileBox = await mobileEditDialog.boundingBox()
  expect(mobileBox?.width).toBeLessThanOrEqual(375)
  await mobileEditDialog.getByRole('button', { name: 'Отмена' }).click()
  await mobileLibrary.getByRole('button', { name: 'Закрыть' }).click()
  await expect(eventGroup).toContainText(assigned.nickname)
  await expect(eventGroup).not.toContainText(free.nickname)
})

test('длинный свободный список групп, счётчик и характеристики на телефоне', async ({
  page,
}) => {
  test.skip(
    test.info().project.name !== 'chromium',
    'Сквозной сценарий интерфейса',
  )
  const officer = await createMember('officer')
  const people = await Promise.all(
    Array.from({ length: 55 }, () => createMember('member')),
  )
  const event = await eventWithAnswers(
    officer,
    people.map((person) => [person, 'yes'] as [Person, 'yes' | 'maybe' | 'no']),
  )
  await sql(
    (db) =>
      db`update app.profiles set class_id = 2 where id in ${db(people.filter((_, index) => index % 2 === 1).map((person) => [person.id]))}`,
  )
  const [lastPerson] = await sql(
    (db) =>
      db`select game_nickname as nickname from app.profiles where id in ${db(people.map((person) => [person.id]))} order by game_nickname desc, id desc limit 1`,
  )
  const [firstPersonRow] = await sql(
    (db) =>
      db`select id from app.profiles where id in ${db(people.map((person) => [person.id]))} order by game_nickname asc, id asc limit 1`,
  )
  const firstPerson = people.find((person) => person.id === firstPersonRow!.id)!
  await page.setViewportSize({ width: 375, height: 812 })
  await signInUi(page, officer.email)
  await expectSignedIn(page)
  await page.goto(`./#/events/${event.id}`)
  await expect(page.getByRole('tab', { name: /Придут/ })).toContainText('55')
  await page.getByRole('button', { name: 'Фильтр по классу Оборотень' }).click()
  await page.getByRole('button', { name: 'Фильтр по классу Друид' }).click()
  const poolViewport = page.getByRole('region', {
    name: 'Прокручиваемый список: Придут',
  })
  await poolViewport.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await expect(page.getByRole('list', { name: 'Придут' })).toContainText(
    lastPerson!.nickname,
  )
  await poolViewport.evaluate((element) => {
    element.scrollTop = 0
  })
  await createGroup(page, 'Длинная пати')
  await moveToGroup(page, firstPerson.nickname, 'Длинная пати')
  await expect(page.getByText('Людей в группах: 1')).toBeVisible()
  await page
    .getByRole('button', { name: `Действия: ${firstPerson.nickname}` })
    .press('Enter')
  await page.getByRole('menuitem', { name: 'Характеристики' }).click()
  await expect(
    page.getByRole('dialog', {
      name: new RegExp(`Характеристики: ${firstPerson.nickname}`),
    }),
  ).toBeVisible()
  expect(await hasHorizontalScroll(page)).toBe(false)
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
