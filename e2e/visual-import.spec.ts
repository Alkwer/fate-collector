import { openPanel, closePanels, toggleEditor, expectEmptyMap, selectRewardGoal } from './ui'
import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import presentationOcr from '../tests/fixtures/presentation-ocr.json' with { type: 'json' }
import type { Capture } from '../shared/schema'
import { newCard, newOffer, newReward } from '../shared/offers'

async function pressCapture(page: Page, cropped: boolean): Promise<Capture> {
  const dataBase64 = (await readFile('prototypes/vision/fixtures/images/press-offer-b.png')).toString('base64')
  const recorded = presentationOcr.cases[cropped ? 'offer-b-panel' : 'offer-b']
  const ocr = { ...recorded.ocr, status: 'ok' as const }
  const image = { width: 1920, height: 1080, dataBase64, mimeType: 'image/png' as const, frameHeight: 1080 }
  if (cropped) {
    const bounds = { x: 475, y: 145, width: 980, height: 520 }
    const png = await page.evaluate(async ({ source, bounds }) => {
      const bytes = Uint8Array.from(atob(source), character => character.charCodeAt(0))
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      const canvas = document.createElement('canvas'); canvas.width = bounds.width; canvas.height = bounds.height
      canvas.getContext('2d')!.drawImage(bitmap, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height)
      bitmap.close()
      return canvas.toDataURL('image/png').split(',')[1]
    }, { source: dataBase64, bounds })
    Object.assign(image, { width: bounds.width, height: bounds.height, dataBase64: png })
  }
  return { kind: 'fate-collector.capture', schemaVersion: 1, captureId: crypto.randomUUID(), capturedAt: new Date().toISOString(),
    source: 'windows-helper', helperVersion: presentationOcr.helperVersion, context: { captureMode: 'fixture' }, image, ocr }
}
async function importCapture(page: Page, capture: Capture) {
  await closePanels(page)
  await page.getByLabel('Import capture file').setInputFiles({ name: `fate-${capture.captureId}.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(capture)) })
  await expect(page.getByRole('heading', { name: 'Torchbearer', exact: true })).toBeVisible()
  await expect(page.locator('.collector-grid')).toHaveAttribute('aria-busy', 'false')
}

for (const cropped of [false, true]) {
  test(`real press pixels pass through import and advisor with ${cropped ? 'calibrated crop' : 'full frame'} coordinates`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const posts: string[] = []
    page.on('request', request => { if (request.method() === 'POST') posts.push(request.url()) })
    await page.setViewportSize({ width: cropped ? 390 : 1440, height: cropped ? 844 : 1000 })
    await page.goto('/')
    const capture = await pressCapture(page, cropped)
    await importCapture(page, capture)
    await expect(page.getByText('Tier 2 · suggested', { exact: true })).toHaveCount(4)
    const unknownRewards = page.locator('.visual-offer .reward-unit[data-unknown]')
    await expect(unknownRewards.filter({ hasText: 'Item Rarity' })).toHaveCount(2)
    await expect(unknownRewards.filter({ hasText: 'Item Rarity' }).first()).toContainText('Kind unknown')
    await expect(unknownRewards.filter({ hasText: 'Silver cluster' })).toBeVisible()
    await expect(page.locator('.visual-offer .reward-unit').filter({ hasText: "Dreadmaidens' Sacrament" })).toContainText('Combo · needs 2')
    await expect(page.locator('.visual-offer .reward-review-note').first()).toContainText('Suggested · check reward row')
    await expect(page.getByRole('heading', { name: 'Torchbearer', exact: true })).toHaveCount(1)
    await expect(page.getByLabel('Compare multiple rewards', { exact: true })).toBeChecked()
    await expect(page.locator('input:visible, textarea:visible, select:visible')).toHaveCount(0)
    await page.getByRole('button', { name: 'Confirm and save', exact: true }).click()
    await closePanels(page)
    await page.getByRole('button', { name: 'Start area with this offer', exact: true }).click()
    await selectRewardGoal(page, 'combo:exceptional gem')
    await closePanels(page)
    await expect(page.getByRole('heading', { name: 'No supported recommendation yet.' })).toBeVisible()
    await page.screenshot({ path: join(tmpdir(), `fate-guided-source-${cropped ? 'mobile' : 'desktop'}.png`), fullPage: true })
    await closePanels(page)
    await page.getByRole('button', { name: 'Edit current offer' }).click()
    await expect(page.getByLabel('I checked this tier against the image')).not.toBeChecked()
    await page.getByLabel('I checked this tier against the image').check()
    await expect(page.getByText('Image suggestion: Gold ring.', { exact: false })).toBeVisible()
    await expect(page.getByLabel('Identified', { exact: true })).not.toBeChecked()
    await page.getByLabel('Fate name', { exact: true }).fill('Torchbearer checked')
    await page.getByRole('button', { name: 'Confirm and save', exact: true }).click()
    await page.reload()
    await closePanels(page)
    await page.getByRole('button', { name: /Saved offers/ }).click()
    await page.getByRole('button', { name: 'Open', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Torchbearer checked', exact: true })).toBeVisible()
    await expect(page.getByText('Tier 2 · suggested', { exact: true })).toHaveCount(3)
    await closePanels(page)
    await page.getByLabel('Import capture file').setInputFiles({ name: 'original.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(capture)) })
    await expect(page.getByRole('status').filter({ hasText: 'already saved' })).toBeVisible()
    await expect(page.locator('.collector-grid')).toHaveAttribute('aria-busy', 'false')
    await expect(page.getByRole('heading', { name: 'Torchbearer checked', exact: true })).toBeVisible()
    await expect(page.getByText('Tier 2 · suggested', { exact: true })).toHaveCount(3)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: join(tmpdir(), `fate-visual-import-${cropped ? 'mobile' : 'desktop'}.png`), fullPage: true })
    expect(errors).toEqual([])
    expect(posts).toEqual([])
  })
}

test('missing crop scale or unavailable worker preserves capture and OCR without a visual claim', async ({ page }) => {
  await page.goto('/')
  const capture = await pressCapture(page, true)
  delete capture.image.frameHeight
  await importCapture(page, capture)
  await expect(page.getByText('Tier 2 · suggested', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Image recognition · no supported suggestions', exact: true }).click()
  await expect(page.getByText('Full-frame height is unavailable for the screenshot crop.', { exact: true })).toBeVisible()
  await expect(page.getByAltText('Captured Fate offer')).toBeVisible()
  await closePanels(page)
  await page.getByRole('button', { name: 'Confirm and save', exact: true }).click()
  await page.evaluate(() => { Object.defineProperty(window, 'Worker', { value: undefined, configurable: true }) })
  await importCapture(page, { ...capture, captureId: crypto.randomUUID(), image: { ...capture.image, frameHeight: 1080 } })
  await expect(page.getByText('Tier 2 · suggested', { exact: true })).toHaveCount(0)
  const unavailable = page.getByText('Visual recognition is unavailable in this browser.', { exact: true })
  if (!await unavailable.isVisible()) await page.getByRole('button', { name: 'Image recognition · no supported suggestions', exact: true }).click()
  await expect(unavailable).toBeVisible()
  await expect(page.getByAltText('Captured Fate offer')).toBeVisible()
})

test('capture imports never infer map membership from a helper session or timestamp', async ({ page }) => {
  await page.goto('/')
  await openPanel(page, '.more-actions')
  await page.getByRole('button', { name: 'Start new area', exact: true }).click()
  const capture = await pressCapture(page, true)
  capture.context = { captureMode: 'fixture', ...capture.context, session: { id: crypto.randomUUID(), startedAt: capture.capturedAt, sequence: 1 } }
  await importCapture(page, capture)
  await expect(page.getByRole('button', { name: 'Add Torchbearer to collected' })).toHaveCount(0)
  await closePanels(page)
  await page.getByRole('button', { name: 'Use this offer in current area' }).click()
  await closePanels(page)
  await page.getByRole('button', { name: 'Add Torchbearer to collected' }).click()
  await page.getByRole('button', { name: 'Confirm and save', exact: true }).click()
  await openPanel(page, '.more-actions')
  await page.getByRole('button', { name: 'New area', exact: true }).click()
  await expectEmptyMap(page)
  await importCapture(page, capture)
  await expect(page.getByRole('button', { name: 'Use this offer in current area' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add Torchbearer to collected' })).toHaveCount(0)
})

test('connected F9 folder intake saves visual candidates automatically and keeps them unreviewed', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: async () => (await navigator.storage.getDirectory()).getDirectoryHandle('captures', { create: true }) })
  })
  await page.goto('/')
  const capture = await pressCapture(page, true)
  await page.evaluate(async capture => {
    const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle('captures', { create: true })
    const file = await directory.getFileHandle(`fate-${capture.captureId}.json`, { create: true })
    const writable = await file.createWritable()
    await writable.write(JSON.stringify(capture)); await writable.close()
  }, capture)
  await openPanel(page, '.map-capture-connection')
  await page.getByRole('button', { name: 'Connect folder', exact: true }).click()
  await closePanels(page)
  await expect(page.getByText('Tier 2 · suggested', { exact: true })).toHaveCount(4)
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible()
  await toggleEditor(page)
  await expect(page.getByLabel('Review status')).toHaveValue('unverified')
  await expect(page.getByLabel('I checked this tier against the image')).not.toBeChecked()
  await closePanels(page)
  await page.getByRole('button', { name: 'Start area with this offer', exact: true }).click()
  await selectRewardGoal(page, 'combo:exceptional gem')
  await closePanels(page)
  await expect(page.getByRole('heading', { name: 'No supported recommendation yet.' })).toBeVisible()
})

for (const width of [1440, 390]) {
  test(`tooltip catalog connects capture, next choice, invocation and map reset at ${width}px`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await page.setViewportSize({ width, height: 960 })
    await page.goto('/')
    await expect(page).toHaveTitle(/Fate Collector/)
    const capture = await pressCapture(page, true)
    await importCapture(page, capture)
    await closePanels(page)
    await page.getByRole('button', { name: 'Start area with this offer', exact: true }).click()
    await selectRewardGoal(page, "combo:dreadmaidens' sacrament")
    await closePanels(page)
    await expect(page.getByRole('heading', { name: 'Provisional preference: Tempest', exact: true })).toBeVisible()
    await closePanels(page)
    await page.getByRole('button', { name: 'Add Tempest to collected', exact: true }).click()
    await page.getByRole('button', { name: 'Confirm and save', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible()

    // A separate synthetic offer exercises a manual tooltip correction; it is
    // not represented as an independent game capture or recognition sample.
    const manual = { ...newOffer(), cards: [{ ...newCard(), name: 'Wildfire', tier: 2, rewards: [newReward()],
      visualReview: { version: 'test-manual-review', rewardsReviewed: true, tierReviewed: true } }] }
    await closePanels(page)
    await page.getByLabel('Import capture file').setInputFiles({ name: 'catalog-offer.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(manual)) })
    await closePanels(page)
    await expect(page.getByRole('heading', { name: 'Archived offer', exact: true })).toBeVisible()
    await toggleEditor(page)
    await page.getByLabel('Count', { exact: true }).fill('2')
    await page.getByRole('combobox', { name: 'Tooltip catalog', exact: true }).selectOption('dreadmaidens-sacrament')
    await expect(page.getByLabel('Count', { exact: true })).toHaveValue('2')
    await expect(page.getByRole('combobox', { name: 'Kind', exact: true })).toHaveValue('combo')
    await expect(page.getByLabel('Combo threshold', { exact: true })).toHaveValue('2')
    await expect(page.getByLabel('Identified', { exact: true })).toBeChecked()
    const reviewed = page.getByLabel('I checked all reward icons, kinds, counts and thresholds', { exact: true })
    await expect(reviewed).not.toBeChecked()
    await reviewed.check()
    await page.getByRole('combobox', { name: 'Tooltip catalog', exact: true }).selectOption('additional-currency')
    await expect(page.getByRole('combobox', { name: 'Kind', exact: true })).toHaveValue('unknown')
    await expect(page.getByLabel('Combo threshold', { exact: true })).toHaveValue('')
    await expect(page.getByLabel('Identified', { exact: true })).not.toBeChecked()
    await expect(reviewed).not.toBeChecked()
    await page.getByRole('combobox', { name: 'Tooltip catalog', exact: true }).selectOption('exceptional-gem')
    await expect(page.getByLabel('Combo threshold', { exact: true })).toHaveValue('3')
    await expect(page.getByText('The three-coloured-gems motif is a different icon.', { exact: false })).toBeVisible()
    await page.getByRole('combobox', { name: 'Tooltip catalog', exact: true }).selectOption('dreadmaidens-sacrament')
    await page.getByLabel('Count', { exact: true }).fill('1')
    await reviewed.check()
    await expect(page.getByAltText("Dreadmaidens' Sacrament reference icon")).toBeVisible()
    await expect(page.getByRole('link', { name: 'GGG tooltip', exact: true })).toHaveAttribute('href', /t=11697s/)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.locator('.reward-editor').screenshot({ path: join(tmpdir(), `fate-catalog-detail-${width}.png`) })
    await page.screenshot({ path: join(tmpdir(), `fate-catalog-editor-${width}.png`), fullPage: true })
    await page.getByRole('button', { name: 'Save offer', exact: true }).click()
    await closePanels(page)
    await page.getByRole('button', { name: 'Use this offer in current area', exact: true }).click()
    await closePanels(page)
    await expect(page.getByRole('heading', { name: 'Provisional preference: Wildfire', exact: true })).toBeVisible()
    await closePanels(page)
    await page.getByRole('button', { name: 'Add Wildfire to collected', exact: true }).click()
    await closePanels(page)
    await page.getByRole('button', { name: 'Plan invocation', exact: true }).click()
    await closePanels(page)
    await expect(page.getByRole('heading', { name: 'Provisional invocation plan', exact: true })).toBeVisible()
    await expect(page.locator('.advisor-plans article').first().locator('.plan-result')).toContainText('2/2Dreadmaidens\' Sacrament iconsCombo ready')
    await expect(page.locator('.advisor-plans article').first().locator('.invocation-order li').nth(0)).toHaveAccessibleName('1. Tempest (collected #1)')
    await expect(page.locator('.advisor-plans article').first().locator('.invocation-order li').nth(1)).toHaveAccessibleName('2. Wildfire (collected #2)')
    await page.screenshot({ path: join(tmpdir(), `fate-catalog-plan-${width}.png`), fullPage: true })
    await page.reload()
    await closePanels(page)
    await page.getByRole('button', { name: 'Continue this area', exact: true }).click()
    await closePanels(page)
    await page.getByRole('button', { name: 'Plan invocation', exact: true }).click()
    await expect(page.locator('.advisor-plans article').first().locator('.plan-result')).toContainText('2/2Dreadmaidens\' Sacrament iconsCombo ready')
    await openPanel(page, '.more-actions')
    await page.getByRole('button', { name: 'New area', exact: true }).click()
    await expectEmptyMap(page)
    await expect(page.getByRole('heading', { name: 'Wildfire', exact: true })).toHaveCount(0)
    await expect(page.locator('vite-error-overlay')).toHaveCount(0)
    expect(errors).toEqual([])
  })
}
