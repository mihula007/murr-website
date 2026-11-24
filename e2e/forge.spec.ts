import { expect, test } from '@playwright/test'
import { hasHorizontalScroll, skipSplash } from './helpers'
import { createMember, expectSignedIn, signInUi } from './supabase'

test('Кузня занимает доступную ширину и подстраивается под экран', async ({
  page,
}) => {
  const member = await createMember('member')
  await skipSplash(page)
  await signInUi(page, member.email)
  await expectSignedIn(page)
  await page.goto('./#/forge/equipment')
  await expect(page.getByRole('heading', { name: 'Эквип' })).toBeVisible()
  await page.getByRole('button', { name: 'Добавить предмет' }).click()
  await expect(page.getByText('Предмет 2')).toBeVisible()

  for (const width of [375, 1280, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(page.getByRole('heading', { name: 'Эквип' })).toBeVisible()
    expect(await hasHorizontalScroll(page)).toBe(false)
  }
})

test('сброс отметок Жребиев можно отменить', async ({ page }) => {
  const member = await createMember('member')
  await skipSplash(page)
  await signInUi(page, member.email)
  await expectSignedIn(page)
  await page.goto('./#/forge/titles')
  await page.getByRole('button', { name: 'Сбросить титулы' }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Отмена' }).click()
  await expect(dialog).toHaveCount(0)
})

test('первый грейд кольца показывает эталонный рецепт', async ({ page }) => {
  const member = await createMember('member')
  await skipSplash(page)
  await signInUi(page, member.email)
  await expectSignedIn(page)
  await page.goto('./#/forge/rings')
  await expect(page.getByText(/Кварц: 25/)).toBeVisible()
  await expect(page.getByText(/Полярные кольца: 1/)).toBeVisible()
})
