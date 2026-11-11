import { openPanel, closePanels } from './ui'
import { test, expect, type Page } from '@playwright/test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { newCard, newOffer, newReward } from '../shared/offers'
import type { FateCard } from '../shared/schema'

function card(name: string, count: number): FateCard {
  return { ...newCard(), name, tier: 2, rewards: [{ ...newReward(), label: 'Currency', kind: 'regular', identified: true, count }] }
}
async function load(page: Page, cards: FateCard[]) {
  await closePanels(page)
  await page.getByLabel('Import capture file').setInputFiles({ name: 'flow.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...newOffer(), cards })) })
  await closePanels(page)
  await page.getByRole('button', { name: /^(Start map with this offer|Use this offer in current map)$/ }).click()
}

test('guides a review to the requested card and returns focus to a recomputed recommendation', async ({ page }) => {
  await page.goto('/')
  const unknown = card('Tempest', 3)
  unknown.rewards[0].identified = false
  unknown.visualReview = { version: 'test', tierReviewed: false, rewardsReviewed: false }
  await load(page, [card('Rot', 1), unknown])
  await openPanel(page, '.reward-settings')
  await page.getByLabel('Reward goal').selectOption('regular:currency')
  await closePanels(page)
  await expect(page.getByRole('heading', { name: 'Provisional preference: Rot' })).toBeVisible()
  await page.getByRole('button', { name: 'Review Tempest', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Reviewing Tempest', exact: true })).toBeFocused()
  await expect(page.getByLabel('Label', { exact: true })).toBeVisible()
  await expect(page.getByRole('radio')).toHaveCount(0)
  await page.getByLabel('Identified', { exact: true }).check()
  await page.getByLabel('I checked this tier against the image').check()
  await page.getByLabel('I checked all reward icons, kinds, counts and thresholds').check()
  await page.getByRole('button', { name: 'Back to advice' }).click()
  await expect(page.getByRole('heading', { name: 'Choose & invoke' })).toBeFocused()
  await closePanels(page)
  await expect(page.getByRole('heading', { name: 'Recommended: Tempest' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Data to check' })).toHaveCount(0)
  await closePanels(page)
  await page.getByRole('button', { name: 'Add Tempest to collected' }).click()
  await expect(page.getByRole('heading', { name: 'Choice added: Tempest' })).toBeVisible()
  await closePanels(page)
  await page.getByRole('button', { name: 'Plan this collection', exact: true }).click()
  await closePanels(page)
  await expect(page.getByRole('heading', { name: 'Suggested invocation plan' })).toBeVisible()
  await page.getByRole('button', { name: 'Mark this invocation completed' }).first().click()
  await expect(page.getByRole('complementary')).toContainText('0/12')
  await closePanels(page)
  await page.getByRole('button', { name: 'Undo collection change' }).click()
  await expect(page.getByRole('complementary')).toContainText('1/12')
})

test('explains no improvement without sending complete data back for correction', async ({ page }) => {
  await page.goto('/')
  await load(page, [card('Rot', 5)])
  await openPanel(page, '.reward-settings')
  await page.getByLabel('Reward goal').selectOption('regular:currency')
  await closePanels(page)
  await page.getByRole('button', { name: 'Add Rot to collected' }).click()
  const neutral = card('Tempest', 1)
  neutral.rewards[0].label = 'Armour'
  await load(page, [neutral])
  await closePanels(page)
  await expect(page.getByRole('heading', { name: 'No improvement for this goal.' })).toBeVisible()
  await expect(page.locator('.advisor-baseline')).toContainText('5')
  await expect(page.locator('.candidate-gain')).toContainText('No gain over your collection')
  await expect(page.getByRole('region', { name: 'Data to check' })).toHaveCount(0)
})

test('keeps a long checklist compact and directs review into a collected card', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const cards = ['Torchbearer', 'Tempest', 'Stormcaller', 'A long Fate name for reviewing the last card without horizontal overflow'].map(name => ({ ...card(name, 1), rewards: [] }))
  await load(page, cards)
  const checks = page.getByRole('region', { name: 'Data to check' })
  await expect(checks.getByRole('button', { name: 'Review Torchbearer' })).toBeVisible()
  await expect(checks.getByRole('button', { name: 'Review Tempest' })).not.toBeVisible()
  await checks.getByRole('button', { name: 'See the other 3 cards', exact: true }).click()
  await checks.getByRole('button', { name: 'Review Tempest' }).click()
  await expect(page.getByRole('heading', { name: 'Reviewing Tempest' })).toBeFocused()
  await page.getByRole('button', { name: 'Back to advice' }).click()
  await closePanels(page)
  await page.getByRole('button', { name: 'Add Tempest to collected' }).click()
  await closePanels(page)
  await page.getByRole('button', { name: 'Plan invocation', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Plan invocation', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await checks.getByRole('button', { name: 'Review Tempest' }).click()
  await expect(page.getByRole('region', { name: 'Collected card details' }).getByRole('heading', { name: 'Reviewing Tempest' })).toBeFocused()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

for (const width of [1440, 820, 390]) {
  test(`guided advice remains usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()) })
    await page.goto('/')
    await expect(page).toHaveTitle('Fate Collector')
    await load(page, [card('Torchbearer', 3), card('Tempest', 1)])
    await openPanel(page, '.reward-settings')
    await page.getByLabel('Reward goal').selectOption('regular:currency')
    await closePanels(page)
    await expect(page.getByRole('heading', { name: 'Recommended: Torchbearer' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add Torchbearer to collected' })).toHaveCount(1)
    await expect(page.locator('.advisor-outcome')).toHaveAttribute('data-state', 'ready')
    await expect(page.locator('.recommended-fate')).toContainText('+3 toward Currency')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: join(tmpdir(), `fate-guided-${width}.png`), fullPage: true })
    await closePanels(page)
    await page.getByRole('button', { name: 'Add Torchbearer to collected' }).click()
    await closePanels(page)
    await page.getByRole('button', { name: 'Plan this collection', exact: true }).click()
    await closePanels(page)
    await expect(page.getByRole('heading', { name: 'Suggested invocation plan' })).toBeVisible()
    expect(errors).toEqual([])
  })
}
