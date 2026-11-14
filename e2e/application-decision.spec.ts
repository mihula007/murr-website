import { expect, test } from '@playwright/test'
import {
  accessToken,
  callApi,
  createMember,
  expectSignedIn,
  signInUi,
  sql,
} from './supabase'
import { skipSplash } from './helpers'
test('офицер принимает кандидата из голосования', async ({ page }) => {
  const candidate = await createMember('applicant')
  const officer = await createMember('officer')
  const [application] = await sql(
    (db) =>
      db<
        { id: string }[]
      >`insert into app.join_applications (applicant_id, status) values (${candidate.id}, 'pending_officer_review') returning id`,
  )
  const token = await accessToken(officer.email)
  const sent = await callApi('applications/submit-to-vote', token, {
    id: application!.id,
  })
  expect(sent.status).toBe(200)
  await skipSplash(page)
  await signInUi(page, officer.email)
  await expectSignedIn(page)
  await page.goto('./#/votes')
  await page
    .getByRole('button', {
      name: new RegExp(`Управление голосованием.*${candidate.nickname}`),
    })
    .click()
  await page.getByRole('menuitem', { name: 'Принять в клан' }).click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Принять в клан' })
    .click()
  await expect(page.getByText('Кандидат принят в клан')).toBeVisible()
  const [result] = await sql(
    (db) =>
      db<
        { status: string; role: string }[]
      >`select a.status, p.access_role as role from app.join_applications a join app.profiles p on p.id = a.applicant_id where a.id = ${application!.id}`,
  )
  expect(result).toEqual({ status: 'admin_approved', role: 'member' })
})
