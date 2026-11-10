import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import presskitOcr from '../tests/fixtures/presskit-ocr.json' with { type: 'json' }
import type { Capture } from '../shared/schema'

async function pressCapture(page: Page, cropped: boolean): Promise<Capture> {
  const dataBase64 = (await readFile('prototypes/vision/fixtures/images/press-offer-b.png')).toString('base64')
  const ocr = { ...presskitOcr, status: 'ok' as const, lines: presskitOcr.lines.map(line => ({ ...line, x: line.x / 2, y: line.y / 2, width: line.width / 2, height: line.height / 2 })) }
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
    ocr.lines = ocr.lines.filter(line => line.x >= bounds.x && line.y >= bounds.y && line.x + line.width <= bounds.x + bounds.width && line.y + line.height <= bounds.y + bounds.height)
      .map(line => ({ ...line, x: line.x - bounds.x, y: line.y - bounds.y }))
  }
  return { kind: 'fate-collector.capture', schemaVersion: 1, captureId: crypto.randomUUID(), capturedAt: new Date().toISOString(),
    source: 'windows-helper', helperVersion: '0.3.2', context: { captureMode: 'fixture' }, image, ocr }
}
async function importCapture(page: Page, capture: Capture) {
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
    await expect(page.getByText('Suggested icons: Gold ring. Meanings need review.', { exact: true })).toBeVisible()
    await expect(page.getByText('Suggested icons: Silver cluster, Orange feathers, Gold ring. Meanings need review.', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Torchbearer', exact: true })).toHaveCount(1)
    await expect(page.locator('input:visible, textarea:visible, select:visible')).toHaveCount(0)
    await page.getByRole('button', { name: 'Confirm and save', exact: true }).click()
    await page.getByRole('button', { name: 'Advisor', exact: true }).click()
    await page.getByLabel('Reward goal').selectOption('combo:exceptional gem')
    await expect(page.getByRole('heading', { name: 'No supported recommendation yet.' })).toBeVisible()
    await page.getByRole('button', { name: 'Edit current offer' }).click()
    await expect(page.getByLabel('I checked this tier against the image')).not.toBeChecked()
    await page.getByLabel('I checked this tier against the image').check()
    await page.getByText('Modifiers & rewards', { exact: false }).click()
    await expect(page.getByText('Image suggestion: Gold ring.', { exact: false })).toBeVisible()
    await expect(page.getByLabel('Identified', { exact: true })).not.toBeChecked()
    await page.getByLabel('Fate name', { exact: true }).fill('Torchbearer checked')
    await page.getByRole('button', { name: 'Confirm and save', exact: true }).click()
    await page.reload()
    await page.getByRole('button', { name: /Saved offers/ }).click()
    await page.getByRole('button', { name: 'Open', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Torchbearer checked', exact: true })).toBeVisible()
    await expect(page.getByText('Tier 2 · suggested', { exact: true })).toHaveCount(3)
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
  await page.getByText('Image recognition · no supported suggestions', { exact: true }).click()
  await expect(page.getByText('Full-frame height is unavailable for the screenshot crop.', { exact: true })).toBeVisible()
  await expect(page.getByAltText('Captured Fate offer')).toBeVisible()
  await page.getByRole('button', { name: 'Confirm and save', exact: true }).click()
  await page.evaluate(() => { Object.defineProperty(window, 'Worker', { value: undefined, configurable: true }) })
  await importCapture(page, { ...capture, captureId: crypto.randomUUID(), image: { ...capture.image, frameHeight: 1080 } })
  await expect(page.getByText('Tier 2 · suggested', { exact: true })).toHaveCount(0)
  const unavailable = page.getByText('Visual recognition is unavailable in this browser.', { exact: true })
  if (!await unavailable.isVisible()) await page.getByText('Image recognition · no supported suggestions', { exact: true }).click()
  await expect(unavailable).toBeVisible()
  await expect(page.getByAltText('Captured Fate offer')).toBeVisible()
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
  await page.getByRole('button', { name: 'Connect folder', exact: true }).click()
  await expect(page.getByText('Tier 2 · suggested', { exact: true })).toHaveCount(4)
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible()
  await page.getByText('Edit details', { exact: true }).click()
  await expect(page.getByLabel('Review status')).toHaveValue('unverified')
  await expect(page.getByLabel('I checked this tier against the image')).not.toBeChecked()
  await page.getByRole('button', { name: 'Advisor', exact: true }).click()
  await page.getByLabel('Reward goal').selectOption('combo:exceptional gem')
  await expect(page.getByRole('heading', { name: 'No supported recommendation yet.' })).toBeVisible()
})
