import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { newCard, newOffer } from '../shared/offers'
import { closePanels, openPanel } from './ui'

async function openReports(page: Page, history = false) {
  await openPanel(page, '.more-actions')
  await page.getByRole('button', { name: history ? 'Symbol report history' : 'Report symbol', exact: true }).click()
  return page.locator('.symbol-reports > .detail-dialog')
}
async function prepare(page: Page) {
  await page.goto('/')
  await openReports(page, true)
  await closePanels(page)
  const png = await readFile('public/game-art/reward-gold-grid.png')
  const captureId = crypto.randomUUID()
  const offer = { ...newOffer(), captureId, gameVersion: 'symbol-e2e', cards: [{ ...newCard(), name: 'Alchemist' }] }
  const evidence = { id: captureId, imageDataUrl: `data:image/png;base64,${png.toString('base64')}`, ocrText: '', ocrStatus: 'not-run', helperVersion: null, ocrLines: [] }
  const archive = { kind: 'fate-collector.export', schemaVersion: 1, offers: [{ offer, evidence }] }
  await page.getByLabel('Import capture file').setInputFiles({ name: 'symbol-offer.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(archive)) })
  await expect(page.getByRole('status')).toContainText('restored on this device')
  await page.getByRole('button', { name: /Saved offers/ }).click()
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await closePanels(page)
  const panel = await openReports(page)
  await panel.getByLabel('Choose symbol image').setInputFiles('public/game-art/reward-gold-grid.png')
  await expect(panel.getByAltText('Symbol image to send')).toBeVisible()
  await panel.getByLabel('Choose tooltip image').setInputFiles('public/game-art/reward-item-rarity.png')
  await expect(panel.getByAltText('Tooltip image to send')).toBeVisible()
  await panel.getByRole('button', { name: 'Enlarge tooltip', exact: true }).click()
  await expect(page.getByAltText('Full size tooltip to send')).toBeVisible()
  await page.getByRole('dialog', { name: 'Enlarge tooltip', exact: true }).getByRole('button', { name: 'Close panel' }).click()
  await panel.getByLabel('Reward name (optional)').fill('SYNTHETIC symbol report')
  await panel.getByLabel('Collection access key', { exact: true }).fill('e2e-local-only')
  return panel
}
test('image report requires explicit consent, uploads both images and survives reload with withdrawal', async ({ page, request }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const panel = await prepare(page)
  const checkbox = panel.getByRole('checkbox', { name: 'I checked both previews and agree to send this report.' })
  await expect(checkbox).not.toBeChecked()
  await expect(panel.getByRole('button', { name: 'Send symbol report', exact: true })).toBeDisabled()
  await checkbox.check()
  await panel.locator(':scope > .detail-body').evaluate(node => { node.scrollTop = 0 })
  await page.screenshot({ path: '.qa/symbol-reports-desktop-top.png', fullPage: true })
  await checkbox.scrollIntoViewIfNeeded()
  await panel.getByLabel('Description / tooltip text (optional)').fill('Text changed after consent')
  await expect(checkbox).not.toBeChecked()
  await checkbox.check()
  await page.screenshot({ path: '.qa/symbol-reports-desktop.png', fullPage: true })
  const sent = page.waitForRequest(request => request.url().endsWith('/api/symbol-reports'))
  await panel.getByRole('button', { name: 'Send symbol report', exact: true }).click()
  const body = (await sent).postDataJSON()
  expect(body.report.icon.mimeType).toBe('image/png'); expect(body.report.tooltip.dataBase64.length).toBeGreaterThan(50)
  expect(body.report.offer.origin).toBe('test'); expect(body.report).not.toHaveProperty('rawScreenshot')
  await expect(panel.getByText('Received — review status unavailable', { exact: true })).toBeVisible()
  await page.reload(); const restored = await openReports(page, true)
  await expect(restored.getByText('Received — review status unavailable', { exact: true })).toBeVisible()
  await restored.getByRole('button', { name: 'Withdraw report', exact: true }).click()
  await expect(restored.getByText('Withdrawn — removed from collection', { exact: true })).toBeVisible()
  const replay = await request.post('/api/symbol-reports', { data: body, headers: { Authorization: 'Bearer e2e-local-only' } })
  expect(replay.status()).toBe(410); expect(errors).toEqual([])
})
test('lost receipt is retried with same report, mobile crop works and withdrawal remains durable offline', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const panel = await prepare(page)
  await panel.getByRole('button', { name: 'Crop symbol from capture', exact: true }).click()
  const crop = page.getByRole('dialog', { name: 'Crop symbol from capture', exact: true })
  await expect(crop.getByAltText('Capture to crop')).toBeVisible()
  await crop.getByRole('button', { name: 'Use this crop', exact: true }).click()
  await expect(crop).not.toBeVisible()
  await panel.locator(':scope > .detail-body').evaluate(node => { node.scrollTop = 0 })
  await page.screenshot({ path: '.qa/symbol-reports-mobile.png', fullPage: true })
  expect(await panel.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
  await panel.getByRole('checkbox', { name: 'I checked both previews and agree to send this report.' }).check()
  const ids: string[] = []
  await page.route('**/api/symbol-reports', async route => {
    ids.push(route.request().postDataJSON().report.id)
    await route.fetch(); await route.abort('failed')
  })
  await panel.getByRole('button', { name: 'Send symbol report', exact: true }).click()
  await expect(panel.getByRole('button', { name: 'Retry upload', exact: true })).toBeEnabled()
  await page.unroute('**/api/symbol-reports')
  const retry = page.waitForRequest(request => request.url().endsWith('/api/symbol-reports'))
  await panel.getByRole('button', { name: 'Retry upload', exact: true }).click()
  expect((await retry).postDataJSON().report.id).toBe(ids[0])
  await expect(panel.getByText('Received — review status unavailable', { exact: true })).toBeVisible()
  await context.setOffline(true)
  await panel.getByRole('button', { name: 'Withdraw report', exact: true }).click()
  await expect(panel.getByRole('button', { name: 'Retry withdrawal', exact: true })).toBeEnabled()
  await expect(panel.getByRole('button', { name: 'Retry upload', exact: true })).toHaveCount(0)
  await context.setOffline(false); await page.reload()
  const restored = await openReports(page, true)
  await restored.getByRole('button', { name: 'Retry withdrawal', exact: true }).click()
  await expect(restored.getByText('Withdrawn — removed from collection', { exact: true })).toBeVisible()
})

for (const source of ['file', 'crop']) test(`late ${source} preparation cannot populate a new report`, async ({ page }) => {
  const panel = await prepare(page)
  await page.evaluate(() => {
    const native = window.createImageBitmap.bind(window)
    window.createImageBitmap = ((image: ImageBitmapSource) => {
      window.createImageBitmap = native
      return new Promise<ImageBitmap>(resolve => {
        Object.assign(window, { releaseReportImage: async () => { resolve(await native(image)) } })
      })
    }) as typeof createImageBitmap
  })
  if (source === 'file') await panel.getByLabel('Choose symbol image').setInputFiles('public/game-art/reward-gold-grid.png')
  else {
    await panel.getByRole('button', { name: 'Crop symbol from capture', exact: true }).click()
    await page.getByRole('dialog', { name: 'Crop symbol from capture', exact: true }).getByRole('button', { name: 'Use this crop', exact: true }).click()
  }
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { releaseReportImage?: unknown }).releaseReportImage)).toBe('function')
  await closePanels(page)
  const fresh = await openReports(page)
  await expect(fresh.getByLabel('Choose symbol image')).toBeEnabled()
  await page.evaluate(async () => { await (window as unknown as { releaseReportImage: () => Promise<void> }).releaseReportImage() })
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await expect(fresh.getByAltText('Symbol image to send')).toHaveCount(0)
  await expect(fresh.getByText('Crop selected. Check its preview below.', { exact: true })).toHaveCount(0)
  await fresh.getByLabel('Choose symbol image').setInputFiles('public/game-art/reward-gold-grid.png')
  await expect(fresh.getByAltText('Symbol image to send')).toBeVisible()
})

test('report action snapshots the newly opened offer and renders the light tablet layout', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 })
  await prepare(page)
  await closePanels(page)
  const next = { ...newOffer(), gameVersion: 'new-offer-version', cards: [{ ...newCard(), name: 'Second report source' }] }
  await page.getByLabel('Import capture file').setInputFiles({ name: 'next.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(next)) })
  await expect(page.getByRole('status')).toContainText('restored on this device')
  await closePanels(page)
  await page.getByRole('button', { name: /Saved offers/ }).click()
  await page.getByRole('row').filter({ hasText: 'Second report source' }).getByRole('button', { name: 'Open', exact: true }).click()
  await closePanels(page)
  await openPanel(page, '.more-actions')
  await page.getByRole('combobox', { name: 'Appearance', exact: true }).selectOption('trail')
  await closePanels(page)
  const panel = await openReports(page)
  await expect(panel.getByRole('combobox', { name: 'Fate', exact: true })).toHaveValue(next.cards[0].id)
  await expect(panel.getByLabel('Game version', { exact: true })).toHaveValue('new-offer-version')
  await expect(panel.getByText(new RegExp(next.id))).toBeVisible()
  await expect(panel.getByAltText('Symbol image to send')).toHaveCount(0)
  await page.screenshot({ path: '.qa/symbol-reports-tablet-light.png', fullPage: true })
  expect(await panel.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
})
