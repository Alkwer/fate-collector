import { test, expect } from '@playwright/test'
import { newCard, newOffer, newReward } from '../shared/offers'
import { openPanel, closePanels } from './ui'

for (const theme of ['mineral', 'trail']) test(`${theme}: visual rewards preserve unknowns, modifiers and invocation identity`, async ({ page }) => {
  await page.goto('/')
  await openPanel(page, '.more-actions')
  await page.getByLabel('Appearance').selectOption(theme)
  await closePanels(page)
  const offer = { ...newOffer(), cards: [
    { ...newCard(), name: 'Alchemist', tier: 2, modifiers: ['Reflects damage', 'More monster life'], rewards: [{ ...newReward(), label: 'Currency', count: 3, kind: 'regular', identified: true }] },
    { ...newCard(), name: 'Unknown Fate with a long name', tier: null, rewards: [{ ...newReward(), label: 'Unknown reward with a long label', count: 2 }] },
    { ...newCard(), name: 'Tempest', tier: 1, rewards: [{ ...newReward(), label: 'Exceptional Gem', kind: 'combo', threshold: 3, identified: true }] },
  ] }
  await page.getByLabel('Import capture file').setInputFiles({ name: 'visual-example.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(offer)) })
  await page.getByRole('button', { name: 'Start map with this offer', exact: true }).click()
  await openPanel(page, '.reward-settings')
  await page.getByLabel('Reward goal').selectOption('regular:currency')
  await closePanels(page)
  const cards = page.locator('.visual-offer .fate-list > li')
  await expect(cards.nth(0).getByRole('img', { name: 'Alchemist Fate artwork' })).toBeVisible()
  await expect(cards.nth(0).locator(':scope > .fate-art img')).toHaveJSProperty('naturalWidth', 112)
  await expect(cards.nth(0).locator(':scope > .reward-strip .reward-symbol img')).toHaveAttribute('src', '/game-art/reward-gold-grid.png')
  await expect(cards.nth(1).locator(':scope > .fate-art')).toContainText('Artwork unavailable')
  await expect(cards.nth(0).locator(':scope > .reward-strip .reward-unit')).toContainText('3×Currency')
  await expect(cards.nth(1)).toContainText('Tier ?')
  await expect(cards.nth(1).locator(':scope > .reward-strip .reward-unit')).toContainText('Kind unknown')
  await expect(cards.nth(1).locator(':scope > .reward-strip .reward-symbol img')).toHaveCount(0)
  await expect(cards.nth(2).locator(':scope > .reward-strip .reward-symbol img')).toBeVisible()
  await cards.nth(0).getByRole('button', { name: 'Modifiers (2)' }).click()
  await expect(page.getByRole('dialog', { name: 'Alchemist · modifiers' })).toContainText('Reflects damage')
  await closePanels(page)
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  }
  await page.getByRole('button', { name: 'Add Alchemist to collected', exact: true }).click()
  await page.getByRole('button', { name: 'Plan invocation', exact: true }).click()
  const best = page.locator('.advisor-plans article[data-best]')
  await expect(best.locator('.invocation-order li')).toHaveAccessibleName('1. Alchemist (collected #1)')
  await expect(best.locator('.plan-result')).toContainText('3Currency icons')
  await expect(best.locator('.invoke-card')).toContainText('Tier 2')
  await expect(best.locator('.invoke-card .fate-art img')).toHaveAttribute('src', '/game-art/alchemist.webp')
  await expect(best.getByText('Then Confirm in game', { exact: true })).toBeVisible()
  await best.getByRole('button', { name: 'Mark this invocation completed' }).click()
  await expect(page.getByRole('complementary')).toContainText('0/12')
  await page.getByRole('button', { name: 'Undo collection change' }).click()
  await expect(page.getByRole('complementary')).toContainText('1/12')
})

test('observed game motifs stay unknown and a missing portrait has a usable fallback', async ({ page }) => {
  await page.route('**/game-art/tempest.webp', route => route.abort())
  await page.goto('/')
  const offer = { ...newOffer(), cards: [{ ...newCard(), name: 'Tempest', tier: 2,
    rewards: [{ ...newReward(), label: 'Blue diamond', visualId: 'blue-diamond', count: 2 }] }] }
  await page.getByLabel('Import capture file').setInputFiles({ name: 'unknown-motif.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(offer)) })
  await page.getByRole('button', { name: 'Start map with this offer', exact: true }).click()
  const card = page.locator('.visual-offer .fate-list > li')
  await expect(card.locator('.fate-art')).toContainText('Artwork unavailable')
  await expect(card.locator('.reward-symbol img')).toHaveAttribute('src', '/game-art/reward-blue-diamond.png')
  await expect(card.locator('.reward-symbol img')).toHaveJSProperty('naturalWidth', 24)
  await expect(card.locator('.reward-unit')).toContainText('Kind unknown · review')
  await expect(page.getByRole('button', { name: 'Review Tempest', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Add Tempest to collected', exact: true }).click()
  await expect(page.getByRole('complementary')).toContainText('Kind unknown · review')
})
