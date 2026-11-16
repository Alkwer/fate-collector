import { test, expect } from '@playwright/test'
import { newCard, newOffer, newReward } from '../shared/offers'
import { closePanels, openPanel, selectRewardGoal } from './ui'

for (const mode of ['single', 'portfolio']) test(`${mode}: triple Fate order, rewards and completion follow Hotfix 3`, async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  for (const [index, count] of [4, 1, 2].entries()) {
    const offer = { ...newOffer(), cards: [{ ...newCard(), name: 'Alchemist', tier: 2,
      rewards: [{ ...newReward(), label: 'Additional Currency Items', kind: 'regular' as const, identified: true, count }] }] }
    await page.getByLabel('Import capture file').setInputFiles({ name: 'triple-fixture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(offer)) })
    await page.getByRole('button', { name: index ? 'Use this offer in current area' : 'Start area with this offer', exact: true }).click()
    if (index === 0 && mode === 'single') {
      await selectRewardGoal(page, 'regular:additional currency items')
      await closePanels(page)
    }
    await page.getByRole('button', { name: 'Add Alchemist to collected', exact: true }).click()
  }
  await page.getByRole('button', { name: 'Plan invocation', exact: true }).click()
  const best = page.locator('.advisor-plans article[data-best]')
  const steps = best.locator('.invocation-order > li')
  await expect(steps).toHaveCount(3)
  await expect(steps.nth(0)).toHaveAccessibleName('1. Alchemist (collected #1)')
  await expect(steps.nth(1)).toHaveAccessibleName('2. Alchemist (collected #2)')
  await expect(steps.nth(2)).toHaveAccessibleName('3. Alchemist (collected #3)')
  await expect(steps.nth(0)).toContainText('Regular rewards ×3')
  await expect(steps.nth(1)).toContainText('Rewards discarded')
  await expect(steps.nth(2)).toContainText('Regular rewards ×3')
  await expect(best.locator('.merge-explanation')).toContainText('First and third regular rewards ×3')
  await expect(best.locator('.merge-equation')).toHaveCount(0)
  await expect(best.locator('.plan-result')).toContainText(mode === 'single' ? '18Additional Currency Items icons' : '54priority points')
  if (mode === 'portfolio') {
    await best.getByRole('button', { name: 'Reward breakdown', exact: true }).click()
    await expect(best.getByRole('definition')).toContainText('18 icon units')
    await closePanels(page)
  }
  for (const theme of ['mineral', 'trail']) {
    await openPanel(page, '.more-actions')
    await page.getByLabel('Appearance').selectOption(theme)
    await closePanels(page)
    for (const width of [1440, 820, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      await expect(best.getByText('First and third regular rewards ×3', { exact: true })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
      await best.screenshot({ path: `test-results/triple-${mode}-${theme}-${width}.png` })
    }
  }
  await best.getByRole('button', { name: 'Mark this invocation completed' }).click()
  await expect(page.getByRole('complementary')).toContainText('0/12')
  await page.getByRole('button', { name: 'Undo collection change' }).click()
  await expect(page.getByRole('complementary')).toContainText('3/12')
  expect(errors).toEqual([])
})
