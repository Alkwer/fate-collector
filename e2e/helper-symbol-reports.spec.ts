import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { stripCanvasPngMetadata } from '../src/lib/symbol-reports'
import { mockTurnstile } from './turnstile'

async function helperDraft() {
  const image = async (name: string) => {
    const bytes = await readFile(`public/game-art/${name}.png`)
    return { mimeType: 'image/png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), dataBase64: stripCanvasPngMetadata(bytes.toString('base64')) }
  }
  return { kind: 'fate-collector.symbol-draft', schemaVersion: 1, id: crypto.randomUUID(), createdAt: new Date().toISOString(), helperVersion: '0.4.0',
    origin: 'test', captureId: null, icon: await image('reward-gold-grid'), tooltip: await image('reward-item-rarity') }
}
async function paste(page: Page, text: string) {
  await expect(page.locator('.symbol-reports > dialog')).toBeVisible()
  await page.evaluate(text => {
    // Firefox clears data supplied to a synthetic ClipboardEvent. Supply the
    // browser-delivered clipboard interface explicitly; exercise our paste listener.
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', { value: { getData: (type: string) => type === 'text/plain' ? text : '' } })
    document.querySelector('.symbol-reports > dialog h2')!.dispatchEvent(event)
  }, text)
}
test('helper handoff starts without an offer, previews both images and sends only after consent and verification', async ({ page }) => {
  await mockTurnstile(page)
  let uploads = 0; page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/symbol-reports')) uploads++ })
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
  await page.goto('/#report-symbol')
  const panel = page.locator('.symbol-reports > dialog')
  await expect(panel).toBeVisible()
  await expect(page).not.toHaveURL(/#report-symbol/)
  const input = await helperDraft()
  await paste(page, JSON.stringify(input))
  await expect(panel.getByAltText('Symbol image to send')).toBeVisible()
  await expect(panel.getByAltText('Tooltip image to send')).toBeVisible()
  await expect(panel.getByText('Not identified', { exact: true })).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Send symbol report', exact: true })).toBeDisabled()
  expect(uploads).toBe(0)
  await page.screenshot({ path: '.qa/helper-symbol-desktop.png', fullPage: true })
  await panel.getByRole('checkbox', { name: 'I checked both previews and agree to send this report.' }).check()
  const sent = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/api/symbol-reports'))
  await panel.getByRole('button', { name: 'Send symbol report', exact: true }).click()
  const upload = await sent, body = upload.postDataJSON()
  expect(body.report).toMatchObject({ icon: input.icon, tooltip: input.tooltip, label: '', description: '', offer: { id: input.id, captureId: null, cardName: '', gameVersion: 'unknown', origin: 'test' } })
  expect(upload.headers()['x-turnstile-token']).toBeTruthy()
  await expect(panel.getByText('Received by the collection.', { exact: true })).toBeVisible()
  await panel.getByRole('button', { name: 'Withdraw report', exact: true }).click()
  await expect(panel.getByText('Withdrawn — removed from collection', { exact: true })).toBeVisible()
  expect(uploads).toBe(1); expect(errors).toEqual([])
})
test('denied clipboard access has a usable file fallback on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: { readText: () => Promise.reject(new Error('denied')) } }))
  await page.goto('/#report-symbol')
  const panel = page.locator('.symbol-reports > dialog')
  await panel.getByRole('button', { name: 'Paste from helper', exact: true }).click()
  await expect(panel.getByRole('alert')).toContainText('Press Ctrl+V')
  await panel.getByRole('button', { name: 'Import saved helper draft', exact: true }).click()
  await panel.getByLabel('Helper draft file').setInputFiles({ name: 'symbol.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(await helperDraft())) })
  await expect(panel.getByRole('dialog', { name: 'Import saved helper draft' })).not.toBeVisible()
  await expect(panel.getByAltText('Tooltip image to send')).toBeVisible()
  await panel.locator(':scope > .detail-body').evaluate(el => { el.scrollTop = 0 })
  await page.screenshot({ path: '.qa/helper-symbol-mobile.png', fullPage: true })
  expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
  await expect(panel.getByRole('checkbox')).not.toBeChecked()
})
test('invalid clipboard data cannot become an offer or bypass the preview', async ({ page }) => {
  await page.goto('/#report-symbol')
  const panel = page.locator('.symbol-reports > dialog')
  await paste(page, 'private clipboard text')
  await expect(panel.getByRole('alert')).toContainText('Copy a symbol draft')
  await expect(panel.getByAltText('Symbol image to send')).toHaveCount(0)
  await paste(page, JSON.stringify({ ...await helperDraft(), consent: true }))
  await expect(panel.getByRole('alert')).toContainText('damaged or unsupported')
  await expect(panel.getByRole('button', { name: 'Send symbol report', exact: true })).toHaveCount(0)
})
test('replacing helper images always clears the previous consent', async ({ page }) => {
  await page.goto('/#report-symbol')
  const panel = page.locator('.symbol-reports > dialog')
  await paste(page, JSON.stringify(await helperDraft()))
  const consent = panel.getByRole('checkbox', { name: 'I checked both previews and agree to send this report.' })
  await consent.check()
  page.once('dialog', dialog => dialog.accept())
  await paste(page, JSON.stringify(await helperDraft()))
  await expect(consent).not.toBeChecked()
  await expect(panel.getByRole('button', { name: 'Send symbol report', exact: true })).toBeDisabled()
})
