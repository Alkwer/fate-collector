import { openPanel } from './ui'
import { test, expect } from '@playwright/test'

test('Mineral Depth is the default; Light Trail persists and synchronizes without resetting a draft', async ({ page, context }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'mineral')
  await expect(page.locator('input:visible, textarea:visible, select:visible')).toHaveCount(0)
  await openPanel(page, '.advanced-panel')
  await page.getByRole('textbox', { name: 'Notes', exact: true }).fill('Keep this draft through theme changes')
  await openPanel(page, '.more-actions')
  await page.getByLabel('Appearance').selectOption('trail')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'trail')
  await openPanel(page, '.advanced-panel')
  await expect(page.getByRole('textbox', { name: 'Notes', exact: true })).toHaveValue('Keep this draft through theme changes')
  const other = await context.newPage()
  await other.goto('/')
  await expect(other.locator('html')).toHaveAttribute('data-theme', 'trail')
  await other.getByRole('button', { name: 'Diagnostics', exact: true }).click()
  await openPanel(other, '.more-actions')
  await other.getByLabel('Appearance').selectOption('mineral')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'mineral')
  await expect(page.getByRole('textbox', { name: 'Notes', exact: true })).toHaveValue('Keep this draft through theme changes')
  await other.reload()
  await expect(other.locator('html')).toHaveAttribute('data-theme', 'mineral')
})

test('theme remains usable when its preference cannot be saved', async ({ page }) => {
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem
    Storage.prototype.setItem = function(key, value) {
      if (key === 'fate-collector.theme') throw new DOMException('Unavailable', 'QuotaExceededError')
      return setItem.call(this, key, value)
    }
  })
  await page.goto('/')
  await openPanel(page, '.more-actions')
  await page.getByLabel('Appearance').selectOption('trail')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'trail')
  await expect(page.getByRole('status')).toContainText('Theme changed for this visit')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'mineral')
})

for (const theme of ['mineral', 'trail']) test(`${theme} keeps the appearance menu keyboard accessible at 320px`, async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 })
  await page.goto('/')
  const summary = page.locator('.more-actions > .panel-trigger')
  await summary.focus()
  await page.keyboard.press('Enter')
  await page.getByLabel('Appearance').selectOption(theme)
  await expect(page.getByLabel('Appearance')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
  await page.keyboard.press('Escape')
  await expect(page.getByLabel('Appearance')).toBeHidden()
  await expect(summary).toBeFocused()
})
