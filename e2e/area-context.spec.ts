import { test, expect } from '@playwright/test'
import { closePanels, openPanel, toggleEditor } from './ui'
import { newOffer } from '../shared/offers'
import { mkdir } from 'node:fs/promises'

for (const width of [390, 900, 1440]) {
  test(`detected area category can be corrected, persisted and filtered at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('/')
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1
      return canvas.toDataURL('image/png').split(',')[1]
    })
    const capture = {
      kind: 'fate-collector.capture', schemaVersion: 1, captureId: crypto.randomUUID(), capturedAt: new Date().toISOString(),
      source: 'windows-helper', helperVersion: '0.5.0', context: { captureMode: 'game', area: { source: 'client-log', category: 'campaign', areaId: '1_1_1', areaLevel: 1 } },
      image: { width: 1, height: 1, mimeType: 'image/png', dataBase64: png },
      ocr: { status: 'unavailable', text: '', language: null, lines: [] },
    }
    const file = { name: 'area-capture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(capture)) }
    await page.getByLabel('Import capture file').setInputFiles(file)
    await toggleEditor(page)
    await expect(page.getByRole('combobox', { name: 'Area category', exact: true })).toHaveValue('campaign')
    await expect(page.getByLabel('Area', { exact: true })).toHaveValue('1_1_1')
    await expect(page.getByLabel('Area level', { exact: true })).toHaveValue('1')
    await page.getByRole('combobox', { name: 'Area category', exact: true }).selectOption('map')
    await expect(page.getByText('Detected from game log:', { exact: false })).toContainText('Campaign')
    await mkdir('output/area-context', { recursive: true })
    await page.getByRole('combobox', { name: 'Area category', exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: `output/area-context/editor-${width}.png`, fullPage: true })
    await closePanels(page)
    await page.getByRole('button', { name: 'Save offer', exact: true }).click()
    await closePanels(page)
    await page.reload()
    await closePanels(page)
    await page.getByLabel('Import capture file').setInputFiles(file)
    await toggleEditor(page)
    await expect(page.getByRole('combobox', { name: 'Area category', exact: true })).toHaveValue('map')
    await closePanels(page)
    await page.getByRole('button', { name: /Saved offers/ }).click()
    await openPanel(page, '.filter-options')
    await page.getByRole('combobox', { name: 'Area category', exact: true }).selectOption('campaign')
    await closePanels(page)
    await expect(page.getByRole('heading', { name: 'No matching offers.' })).toBeVisible()
    await openPanel(page, '.filter-options')
    await page.getByRole('combobox', { name: 'Area category', exact: true }).selectOption('map')
    await page.screenshot({ path: `output/area-context/filter-${width}.png`, fullPage: true })
    await closePanels(page)
    await expect(page.locator('.history-table tbody tr')).toHaveCount(1)
    await expect(page.locator('.history-table')).toContainText('Map · 1_1_1')
    await page.screenshot({ path: `output/area-context/archive-${width}.png`, fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

test('legacy offers expose an editable unknown category', async ({ page }) => {
  await page.goto('/')
  const { areaCategory: omitted, ...legacy } = newOffer()
  await page.getByLabel('Import capture file').setInputFiles({ name: 'legacy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(legacy)) })
  await toggleEditor(page)
  await expect(page.getByRole('combobox', { name: 'Area category', exact: true })).toHaveValue('unknown')
  await page.getByRole('combobox', { name: 'Area category', exact: true }).selectOption('other')
  await expect(page.getByRole('combobox', { name: 'Area category', exact: true })).toHaveValue('other')
})

test('long area identifiers fit the preview and editor on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const areaId = 'UnrecognizedArea'.repeat(10)
  const offer = { ...newOffer(), area: areaId, areaLevel: 83, captureId: crypto.randomUUID(),
    captureContext: { captureMode: 'game', area: { source: 'client-log', category: 'unknown', areaId, areaLevel: 83 } } }
  await page.getByLabel('Import capture file').setInputFiles({ name: 'long-area.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(offer)) })
  await expect(page.getByRole('heading', { name: 'Archived offer', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await toggleEditor(page)
  const details = page.getByRole('region', { name: 'Capture details' })
  expect(await details.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
  await page.getByText('Detected from game log:', { exact: false }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'output/area-context/long-area-390.png', fullPage: true })
  await closePanels(page)
  await page.getByRole('button', { name: /Saved offers/ }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
