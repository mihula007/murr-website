import { expect, test, type Browser } from '@playwright/test'
import { hasHorizontalScroll, skipSplash } from './helpers'
import {
  accessToken,
  callApi,
  createMember,
  expectSignedIn,
  signInUi,
  sql,
} from './supabase'

async function signedIn(browser: Browser, email: string, width: number) {
  const page = await browser.newPage({ viewport: { width, height: 900 } })
  await skipSplash(page)
  await signInUi(page, email)
  await expectSignedIn(page)
  await page.goto('./#/kh')
  return page
}

test('участник записывается в конец, снимается, а мастер отмечает выдачу', async ({
  browser,
}) => {
  test.setTimeout(120_000)
  const member = await createMember('member')
  const admin = await createMember('admin')
  const master = await createMember('master')

  const memberPage = await signedIn(browser, member.email, 375)
  await expect(
    memberPage.getByRole('heading', { name: 'Очередь наград КХ' }),
  ).toBeVisible()
  await memberPage.getByRole('button', { name: /^призывы/ }).click()
  const summonsJoin = memberPage.getByRole('button', {
    name: 'Встать в очередь «призывы»',
  })
  await summonsJoin.click()
  await expect(
    memberPage.getByText(member.nickname, { exact: true }),
  ).toBeVisible()
  await expect(
    memberPage.getByRole('button', {
      name: `Убрать ${member.nickname} из очереди «призывы»`,
    }),
  ).toBeVisible()

  await memberPage.getByRole('button', { name: /^пет/ }).click()
  await memberPage
    .getByRole('button', { name: 'Встать в очередь «пет»' })
    .click()
  await expect(
    memberPage.getByText(member.nickname, { exact: true }),
  ).toBeVisible()
  expect(await hasHorizontalScroll(memberPage)).toBe(false)

  const adminPage = await signedIn(browser, admin.email, 1280)
  await expect(
    adminPage.getByRole('button', {
      name: `Отметить выдачу: ${member.nickname} в очереди «призывы»`,
    }),
  ).toHaveCount(0)
  expect(await hasHorizontalScroll(adminPage)).toBe(false)

  const masterPage = await signedIn(browser, master.email, 1280)
  const issue = masterPage.getByRole('button', {
    name: `Отметить выдачу: ${member.nickname} в очереди «призывы»`,
  })
  await expect(issue).toBeVisible()
  await issue.click()
  await expect(
    masterPage.getByRole('button', {
      name: `Отметить выдачу: ${member.nickname} в очереди «призывы»`,
    }),
  ).toHaveCount(0)

  await memberPage.reload()
  await expect(
    memberPage.getByRole('heading', { name: 'Очередь наград КХ' }),
  ).toBeVisible()
  await memberPage.getByRole('button', { name: /^призывы/ }).click()
  await expect(
    memberPage.getByRole('button', { name: 'Встать в очередь «призывы»' }),
  ).toBeVisible()
  await memberPage.getByRole('button', { name: /^пет/ }).click()
  await memberPage
    .getByRole('button', {
      name: `Убрать ${member.nickname} из очереди «пет»`,
    })
    .click()
  expect(await hasHorizontalScroll(masterPage)).toBe(false)

  await memberPage.close()
  await adminPage.close()
  await masterPage.close()
})

test('роль чтеца не открывает КХ и показывается во всю ширину на компьютере', async ({
  browser,
}) => {
  const reader = await createMember('reader')
  const page = await signedIn(browser, reader.email, 1280)
  await expect(page.getByRole('heading', { name: 'Нет доступа' })).toBeVisible()
  expect(await hasHorizontalScroll(page)).toBe(false)
  await page.close()
})

test('кандидат не открывает КХ, а потерявший доступ участник удаляется из очереди', async ({
  browser,
}) => {
  const member = await createMember('member')
  const master = await createMember('master')
  const applicant = await createMember('applicant')
  const memberPage = await signedIn(browser, member.email, 375)
  await memberPage.getByRole('button', { name: /^призывы/ }).click()
  await memberPage
    .getByRole('button', { name: 'Встать в очередь «призывы»' })
    .click()
  await expect(
    memberPage.getByText(member.nickname, { exact: true }),
  ).toBeVisible()

  const masterToken = await accessToken(master.email)
  expect(
    (
      await callApi('accounts/set-role', masterToken, {
        userId: member.id,
        role: 'reader',
      })
    ).status,
  ).toBe(200)
  const rows = await sql(
    (db) => db<{ count: number }[]>`
      select count(*)::int as count from app.kh_queue_entries
      where user_id = ${member.id}
    `,
  )
  expect(rows[0]?.count).toBe(0)

  await memberPage.reload()
  await expect(
    memberPage.getByRole('heading', { name: 'Нет доступа' }),
  ).toBeVisible()
  const applicantPage = await signedIn(browser, applicant.email, 1280)
  await expect(
    applicantPage.getByRole('heading', { name: 'Нет доступа' }),
  ).toBeVisible()
  expect(await hasHorizontalScroll(applicantPage)).toBe(false)
  await memberPage.close()
  await applicantPage.close()
})
