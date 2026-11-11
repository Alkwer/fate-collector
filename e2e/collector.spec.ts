import { CONSENT_VERSION, consentText } from '../shared/consent'
import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { newOffer, newCard } from '../shared/offers'
import { HELPER_VERSION } from '../src/lib/helper-version'

async function helperCapture(page: Page, possibleRepeat = false) {
  return page.evaluate(possibleRepeat => {
    const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 600
    const context = canvas.getContext('2d')!
    context.fillStyle = '#191c19'; context.fillRect(0, 0, 1000, 600)
    context.fillStyle = '#eee9dc'; context.font = '26px sans-serif'
    context.fillText('Alchemist', 40, 80); context.fillText('Sanguine', 400, 80)
    context.fillText('Fates', 450, 25); context.fillText('CONFIRM', 450, 525)
    const capturedAt = new Date().toISOString()
    const captureContext = possibleRepeat ? {
      session: { id: crypto.randomUUID(), startedAt: capturedAt, sequence: 2 },
      possibleDuplicate: { ofCaptureId: crypto.randomUUID(), reason: 'same-ocr-within-15s' },
    } : {}
    return { kind: 'fate-collector.capture', schemaVersion: 1, captureId: crypto.randomUUID(), capturedAt, source: 'windows-helper', helperVersion: '0.1.0', context: { captureMode: 'fixture', ...captureContext },
      image: { width: 1000, height: 600, mimeType: 'image/png', dataBase64: canvas.toDataURL('image/png').split(',')[1] },
      ocr: { status: 'ok', text: 'Fates\nAlchemist\nSanguine\nCONFIRM', language: 'en-US', lines: [
        { text: 'Fates', x: 450, y: 5, width: 80, height: 20 },
        { text: 'Alchemist', x: 40, y: 55, width: 140, height: 30 }, { text: 'Sanguine', x: 400, y: 55, width: 140, height: 30 },
        { text: 'CONFIRM', x: 450, y: 500, width: 130, height: 25 },
      ] } }
  }, possibleRepeat)
}

test('a stale manual editor preserves its draft after another tab deletes the offer', async ({ page, context }) => {
  await page.goto('/')
  const sample = { ...newOffer(), cards: [{ ...newCard(), name: 'Delete regression' }] }
  await page.getByLabel('Import capture file').setInputFiles({ name: 'offer.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(sample)) })
  await page.getByText('Edit details', { exact: true }).click()
  const other = await context.newPage()
  other.on('dialog', dialog => dialog.accept())
  await other.goto('/')
  await other.getByRole('button', { name: /Saved offers/ }).click()
  await other.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(other.getByRole('heading', { name: 'No offers here yet.' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Notes', exact: true }).fill('Keep this draft')
  await page.getByRole('button', { name: 'Save offer', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('deleted in another tab')
  await expect(page.getByRole('textbox', { name: 'Notes', exact: true })).toHaveValue('Keep this draft')
  await other.reload()
  await other.getByRole('button', { name: /Saved offers/ }).click()
  await expect(other.getByRole('heading', { name: 'No offers here yet.' })).toBeVisible()
})

test('helper import auto-fills text, saves evidence, survives reload, and avoids duplicate imports', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
  await page.goto('/')
  const bundle = await helperCapture(page, true)
  const file = { name: 'capture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bundle)) }
  await page.getByLabel('Import capture file').setInputFiles(file)
  await expect(page.getByRole('heading', { name: 'Alchemist', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Sanguine', exact: true })).toBeVisible()
  await expect(page.getByText('Session capture #2 · Possible repeat (matching OCR)', { exact: true })).toBeVisible()
  await expect(page.locator('input:visible, textarea:visible, select:visible')).toHaveCount(0)
  await expect(page.getByAltText('Captured Fate offer')).toBeVisible()
  await expect(page.getByText('Newer Windows helper available', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: `Download helper ${HELPER_VERSION}`, exact: true })).toHaveAttribute('href', '/downloads/fate-collector-helper.zip')
  await page.getByRole('button', { name: 'Enlarge source screenshot' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: 'Source evidence' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Enlarge source screenshot' })).toBeFocused()
  await page.getByText('Edit details', { exact: true }).click()
  await page.getByLabel('Fate name', { exact: true }).fill('Alchemist corrected')
  await page.getByText('Edit details', { exact: true }).click()
  await page.getByRole('button', { name: 'Confirm and save', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('saved on this device')
  await page.reload()
  await page.getByRole('button', { name: /Saved offers/ }).click()
  await expect(page.getByRole('cell', { name: /Alchemist corrected/ })).toBeVisible()
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(page.getByAltText('Captured Fate offer')).toBeVisible()
  await page.getByLabel('Import capture file').setInputFiles(file)
  await expect(page.getByRole('status')).toContainText('already saved')
  await expect(page.getByRole('heading', { name: 'Alchemist corrected', exact: true })).toBeVisible()
  await page.getByText('More actions', { exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export JSON' }).click()
  const exported = await download
  expect(exported.suggestedFilename()).toBe('fate-collector-export.json')
  const archive = JSON.parse(await readFile((await exported.path())!, 'utf8'))
  expect(archive.offers[0].offer).toMatchObject({ reviewed: true, completeness: 'complete', captureContext: bundle.context, encounterNumber: 1 })
  await page.getByRole('button', { name: /Saved offers/ }).click()
  await expect(page.getByRole('button', { name: 'Share', exact: true })).toBeDisabled()
  expect(errors).toEqual([])
})

test('paste capture works and malformed imports preserve the active draft', async ({ page }) => {
  await page.goto('/')
  const bundle = await helperCapture(page)
  await page.evaluate(value => { const data = new DataTransfer(); data.setData('text/plain', value); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true })) }, JSON.stringify(bundle))
  await expect(page.getByRole('heading', { name: 'Alchemist', exact: true })).toBeVisible()
  page.on('dialog', dialog => dialog.accept())
  await page.getByLabel('Import capture file').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{broken') })
  await expect(page.getByRole('alert')).toContainText('valid JSON')
  await expect(page.getByRole('heading', { name: 'Alchemist', exact: true })).toBeVisible()
  await page.getByText('More actions', { exact: true }).click()
  await page.getByRole('button', { name: 'Save for later', exact: true }).click()
  await page.getByRole('button', { name: /Saved offers/ }).click()
  await expect(page.getByRole('cell', { name: 'unverified Needs review', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm and save' }).click()
  await page.getByRole('button', { name: /Saved offers/ }).click()
  await expect(page.getByRole('cell', { name: 'complete Reviewed', exact: true })).toBeVisible()
})

test('reviewed live offer shares to local D1; retries are idempotent; evidence is not sent', async ({ page, request }) => {
  await page.goto('/')
  await page.getByText('Edit details', { exact: true }).click()
  await page.getByRole('button', { name: 'Add card', exact: true }).click()
  await page.getByLabel('Fate name', { exact: true }).fill('Conjurer')
  await page.getByRole('combobox', { name: 'Origin', exact: true }).selectOption('live')
  await page.getByLabel('Game version', { exact: true }).fill('local-e2e-test')
  await page.getByRole('combobox', { name: 'Review status', exact: true }).selectOption('partial')
  await page.getByRole('button', { name: 'Save offer', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('saved on this device')
  await page.getByRole('button', { name: /Saved offers/ }).click()
  await page.getByLabel('Collection access key').fill('e2e-local-only')
  await page.getByRole('checkbox', { name: 'I have read this information and agree to share reviewed offers.' }).check()
  await page.getByRole('button', { name: 'Accept data sharing', exact: true }).click()
  await expect(page.getByText('Sharing consent active.', { exact: false })).toBeVisible()
  const submission = page.waitForRequest(r => r.url().endsWith('/api/observations') && r.method() === 'POST')
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  const body = (await submission).postDataJSON() as object
  expect(body).toMatchObject({ reviewed: true, completeness: 'partial' })
  expect(body).not.toHaveProperty('imageDataUrl'); expect(body).not.toHaveProperty('ocrText')
  await expect(page.getByRole('status')).toContainText('Reviewed offer shared')
  await expect(page.getByRole('button', { name: 'Share', exact: true })).toBeDisabled()
  const retry = await request.post('/api/observations', { headers: (await submission).headers(), data: body })
  expect(retry.status()).toBe(200)
  expect(await retry.json()).toMatchObject({ status: 'duplicate' })
})

test('real Worker rejects unauthenticated writes and test data; security headers and helper package are served', async ({ request }) => {
  const offer = { ...newOffer(), reviewed: true, completeness: 'partial', cards: [{ ...newCard(), name: 'Conjurer' }] }
  expect((await request.post('/api/observations', { data: offer })).status()).toBe(401)
  expect((await request.post('/api/observations', { headers: { Authorization: 'Bearer e2e-local-only' }, data: offer })).status()).toBe(428)
  const consent = { id: crypto.randomUUID(), token: 'a'.repeat(64), scope: 'observations', policyVersion: CONSENT_VERSION, acceptedAt: new Date().toISOString(), text: consentText('observations', 'http://127.0.0.1:8790') }
  expect((await request.post('/api/consents', { headers: { Authorization: 'Bearer e2e-local-only' }, data: consent })).status()).toBe(201)
  expect((await request.post('/api/observations', { headers: { Authorization: 'Bearer e2e-local-only', 'X-Consent-Id': consent.id, 'X-Consent-Token': consent.token }, data: offer })).status()).toBe(422)
  expect((await request.get('/api/not-real')).status()).toBe(404)
  const homepage = await request.get('/')
  expect(homepage.headers()['content-security-policy']).toContain("frame-ancestors 'none'")
  const helper = await request.get('/downloads/fate-collector-helper.zip')
  expect(helper.status()).toBe(200)
  expect((await helper.body()).subarray(0, 2).toString()).toBe('PK')
})

test('phone layout keeps primary actions reachable without page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('main')).toBeFocused()
  await page.getByText('More actions', { exact: true }).click()
  await page.getByRole('button', { name: 'Load example' }).click()
  await expect(page.getByRole('heading', { name: 'Alchemist', exact: true })).toBeVisible()
  await expect(page.locator('input:visible, textarea:visible, select:visible')).toHaveCount(0)
  await page.getByRole('button', { name: 'Save offer', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('saved on this device')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: /Saved offers/ }).click()
  await expect(page.getByRole('button', { name: 'Open', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('a helper capture can be confirmed in one click without completing fields; edits invalidate its review', async ({ page }) => {
  await page.goto('/')
  const bundle = await helperCapture(page)
  await page.getByLabel('Import capture file').setInputFiles({ name: 'capture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bundle)) })
  await expect(page.locator('input:visible, textarea:visible, select:visible')).toHaveCount(0)
  await page.getByRole('button', { name: 'Confirm and save' }).click()
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeDisabled()
  await expect(page.locator('.action-band')).toContainText('Review saved.')
  await expect(page.locator('.action-band')).toContainText('Reviewed · all offered cards are included.')
  await expect(page.locator('.action-band')).not.toContainText('Confirm all offered cards')
  await page.getByRole('button', { name: /Saved offers/ }).click()
  await expect(page.getByRole('cell', { name: 'complete Reviewed', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await page.getByText('Edit details', { exact: true }).click()
  await page.getByLabel('Fate name', { exact: true }).fill('Updated name')
  await expect(page.getByRole('combobox', { name: 'Review status', exact: true })).toHaveValue('unverified')
  await expect(page.locator('.action-band')).toContainText('Confirm all offered cards')
  await expect(page.locator('.action-band')).not.toContainText('Review saved.')
  // A known incomplete offer must never be promoted to complete by the main action.
  await page.getByRole('combobox', { name: 'Review status', exact: true }).selectOption('partial')
  await page.getByRole('button', { name: 'Confirm and save' }).click()
  await expect(page.locator('.action-band')).toContainText('Reviewed · some cards are missing.')
  await page.getByRole('button', { name: /Saved offers/ }).click()
  await expect(page.getByRole('cell', { name: 'partial Reviewed', exact: true })).toBeVisible()
})

test('phone review puts extracted Fates before the compact source and keeps source zoom accessible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const bundle = await helperCapture(page, true)
  await page.getByLabel('Import capture file').setInputFiles({ name: 'capture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bundle)) })
  await expect(page.locator('.collector-grid')).toHaveAttribute('aria-busy', 'false')
  await page.screenshot({ path: join(tmpdir(), 'fate-map-first-offer-mobile.png'), fullPage: true })
  await expect(page.getByText('Session capture #2 · Possible repeat (matching OCR)', { exact: true })).toBeInViewport()
  await expect(page.getByRole('heading', { name: 'Alchemist', exact: true })).toBeInViewport()
  const fate = await page.getByRole('heading', { name: 'Offered Fates' }).boundingBox()
  const source = await page.getByRole('heading', { name: 'Your capture', exact: true }).boundingBox()
  expect(fate!.y).toBeLessThan(source!.y)
  expect((await page.getByAltText('Captured Fate offer').boundingBox())!.height).toBeLessThanOrEqual(160)
  await expect(page.locator('input:visible, textarea:visible, select:visible')).toHaveCount(0)
  await page.getByRole('button', { name: 'Enlarge source screenshot' }).click()
  await expect(page.getByRole('dialog', { name: 'Source evidence' })).toBeVisible()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Enlarge source screenshot' })).toBeFocused()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('unread evidence saves without being marked reviewed or complete', async ({ page }) => {
  await page.goto('/')
  const bundle = await helperCapture(page)
  bundle.ocr.status = 'unavailable'; bundle.ocr.lines = []; bundle.ocr.text = ''
  await page.getByLabel('Import capture file').setInputFiles({ name: 'unread.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bundle)) })
  await expect(page.getByRole('button', { name: 'Confirm and save' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Save offer', exact: true }).click()
  await page.getByRole('button', { name: /Saved offers/ }).click()
  await expect(page.getByRole('cell', { name: 'unverified Needs review', exact: true })).toBeVisible()
})

test('reimporting a helper file restores a missing screenshot without overwriting reviewed corrections', async ({ page }) => {
  await page.goto('/')
  const bundle = await helperCapture(page)
  const offer = { ...newOffer(), id: bundle.captureId, captureId: bundle.captureId, source: 'windows-helper', reviewed: true, completeness: 'complete', cards: [{ ...newCard(), name: 'Preserved correction' }] }
  await page.getByLabel('Import capture file').setInputFiles({ name: 'metadata.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(offer)) })
  await expect(page.getByRole('status')).toContainText('restored on this device')
  await expect(page.getByAltText('Captured Fate offer')).toHaveCount(0)
  await page.getByLabel('Import capture file').setInputFiles({ name: 'original.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bundle)) })
  await expect(page.getByRole('status')).toContainText('screenshot and OCR restored')
  await expect(page.getByAltText('Captured Fate offer')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Preserved correction', exact: true })).toBeVisible()
  await page.getByRole('button', { name: /Saved offers/ }).click()
  await expect(page.getByRole('cell', { name: 'complete Reviewed', exact: true })).toBeVisible()
  await expect(page.getByText('Revision 1', { exact: true })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: /Saved offers/ }).click()
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(page.getByAltText('Captured Fate offer')).toBeVisible()
})

test('pending corrections cannot share an older reviewed revision', async ({ page }) => {
  await page.goto('/')
  const offer = { ...newOffer(), origin: 'live', gameVersion: 'local-e2e-test', reviewed: true, completeness: 'partial', cards: [{ ...newCard(), name: 'Conjurer' }] }
  await page.getByLabel('Import capture file').setInputFiles({ name: 'reviewed.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(offer)) })
  await expect(page.getByRole('status')).toContainText('restored on this device')
  await page.getByText('Edit details', { exact: true }).click()
  await page.getByLabel('Notes', { exact: true }).fill('Pending correction')
  await page.getByRole('button', { name: /Saved offers/ }).click()
  await page.getByLabel('Collection access key').fill('e2e-local-only')
  await page.getByRole('checkbox', { name: 'I have read this information and agree to share reviewed offers.' }).check()
  await page.getByRole('button', { name: 'Accept data sharing', exact: true }).click()
  await expect(page.getByText('Sharing consent active.', { exact: false })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Unsaved changes', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Share', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Share', exact: true })).toHaveAttribute('title', 'Save your changes before sharing this offer.')
  await page.getByRole('button', { name: 'Resume archived review', exact: true }).click()
  await page.getByText('Edit details', { exact: true }).click()
  await page.getByRole('combobox', { name: 'Review status', exact: true }).selectOption('partial')
  await page.getByRole('button', { name: 'Save offer', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('saved on this device')
  await page.getByRole('button', { name: /Saved offers/ }).click()
  await expect(page.getByRole('button', { name: 'Share', exact: true })).toBeEnabled()
})

test('a stale tab preserves its draft and cannot overwrite another tab', async ({ page, context }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await page.getByText('More actions', { exact: true }).click()
  await page.getByRole('button', { name: 'Load example' }).click()
  await page.getByRole('button', { name: 'Save offer', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('saved on this device')
  const other = await context.newPage()
  other.on('pageerror', error => errors.push(error.message))
  await other.goto('/')
  await other.getByRole('button', { name: /Saved offers/ }).click()
  await other.getByRole('button', { name: 'Open', exact: true }).click()
  await other.getByText('Edit details', { exact: true }).click()
  await other.getByLabel('Area', { exact: true }).fill('Unsaved second-tab area')
  await page.getByText('Edit details', { exact: true }).click()
  await page.getByRole('textbox', { name: 'Notes', exact: true }).fill('Keep the newer correction')
  await page.getByRole('button', { name: 'Save offer', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeDisabled()
  await other.getByRole('button', { name: 'Save offer', exact: true }).click()
  await expect(other.getByRole('alert')).toContainText('changed in another tab')
  await expect(other.getByLabel('Area', { exact: true })).toHaveValue('Unsaved second-tab area')
  await page.reload()
  await page.getByRole('button', { name: /Saved offers/ }).click()
  await expect(page.getByText('Revision 2', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await page.getByText('Edit details', { exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Notes', exact: true })).toHaveValue('Keep the newer correction')
  await expect(page.getByLabel('Area', { exact: true })).toHaveValue('')
  expect(errors).toEqual([])
})

for (const format of ['offer', 'archive'] as const) {
  test(`restoring a single ${format} preserves a shared revision and edits create the next revision`, async ({ page, request }) => {
    const offer = { ...newOffer(), revision: 7, updatedAt: '2026-01-01T00:00:00.000Z', origin: 'live', gameVersion: 'backup-e2e', reviewed: true, completeness: 'partial', cards: [{ ...newCard(), name: 'Conjurer' }] }
    await page.goto('/')
    await page.getByRole('button', { name: /Saved offers/ }).click()
    await page.getByLabel('Collection access key').fill('e2e-local-only')
    await page.getByRole('checkbox', { name: 'I have read this information and agree to share reviewed offers.' }).check()
    const grantRequest = page.waitForRequest(r => r.url().endsWith('/api/consents'))
    await page.getByRole('button', { name: 'Accept data sharing', exact: true }).click()
    await expect(page.getByText('Sharing consent active.', { exact: false })).toBeVisible()
    const grant = (await grantRequest).postDataJSON()
    const headers = { Authorization: 'Bearer e2e-local-only', 'X-Consent-Id': grant.id, 'X-Consent-Token': grant.token }
    expect((await request.post('/api/observations', { headers, data: offer })).status()).toBe(201)
    const backup = format === 'offer' ? offer : { kind: 'fate-collector.export', schemaVersion: 1, offers: [{ offer, evidence: null }] }
    await page.getByLabel('Import capture file').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) })
    await expect(page.getByRole('status')).toContainText('restored on this device')
    await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: /Saved offers/ }).click()
    const duplicateResponse = page.waitForResponse(r => r.url().endsWith('/api/observations'))
    await page.getByRole('button', { name: 'Share', exact: true }).click()
    const duplicate = await duplicateResponse
    expect(duplicate.status()).toBe(200)
    expect(await duplicate.json()).toMatchObject({ status: 'duplicate', revision: 7 })
    expect(duplicate.request().postDataJSON()).toEqual(offer)
    await expect(page.getByRole('status')).toContainText('Reviewed offer shared')
    await page.getByRole('button', { name: 'Open', exact: true }).click()
    await page.getByText('Edit details', { exact: true }).click()
    await page.getByLabel('Notes', { exact: true }).fill('Correction after restoring')
    await page.getByRole('combobox', { name: 'Review status', exact: true }).selectOption('partial')
    await page.getByRole('button', { name: 'Save offer', exact: true }).click()
    await page.getByRole('button', { name: /Saved offers/ }).click()
    const correctedResponse = page.waitForResponse(r => r.url().endsWith('/api/observations'))
    await page.getByRole('button', { name: 'Share', exact: true }).click()
    const corrected = await correctedResponse
    expect(corrected.status()).toBe(201)
    expect(corrected.request().postDataJSON()).toMatchObject({ revision: 8, notes: 'Correction after restoring' })
    await expect(page.getByRole('status')).toContainText('Reviewed offer shared')
  })
}
