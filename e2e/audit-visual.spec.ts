import { expect, test } from '@playwright/test'
import { openPanel } from './ui'

for (const theme of ['mineral', 'trail']) for (const [size, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]] as const) {
  for (const scene of ['unknown', 'recommendation', 'invocation', 'edit', 'symbols']) test(`${theme} ${size} ${scene}`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await page.clock.setFixedTime(new Date('2026-11-13T10:00:00Z'))
    await page.addInitScript(value => localStorage.setItem('fate-collector.theme', value), theme)
    await page.goto('/'); await openPanel(page, '.more-actions')
    await page.getByRole('button', { name: scene === 'unknown' ? 'Load example' : 'Load guided practice', exact: true }).click()
    await page.getByRole('button', { name: 'Start area with this offer', exact: true }).click()
    if (scene === 'invocation') {
      await page.getByRole('button', { name: 'Add Alchemist to collected', exact: true }).click()
      await page.getByRole('button', { name: 'Plan this collection', exact: true }).first().click()
    }
    if (scene === 'edit') await openPanel(page, '.advanced-panel')
    if (scene === 'symbols') {
      await openPanel(page, '.more-actions'); await page.getByRole('button', { name: 'Report symbol', exact: true }).click()
      await expect(page.locator('.symbol-reports > .detail-dialog')).toBeVisible()
    }
    await page.evaluate(() => document.fonts.ready)
    await expect(page).toHaveScreenshot(`${theme}-${size}-${scene}.png`, {
      fullPage: scene !== 'symbols' && scene !== 'edit',
      mask: scene === 'symbols' || scene === 'edit' ? [] : [page.locator('.map-session p'), page.locator('time'), page.locator('.mono')],
    })
  })
}
