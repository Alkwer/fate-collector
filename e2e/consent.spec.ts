import { openDisclosure } from './ui'
import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { newCard, newOffer } from '../shared/offers'
import { consentText } from '../shared/consent'

const checkbox = 'I have read this information and agree to share reviewed offers.'
async function openSharing(page: Page, withOffer = true) {
  await page.goto('/')
  if (withOffer) {
    const offer = { ...newOffer(), origin: 'live', gameVersion: 'consent-e2e', reviewed: true, completeness: 'partial', cards: [{ ...newCard(), name: 'Consent test' }] }
    await page.getByLabel('Import capture file').setInputFiles({ name: 'reviewed.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(offer)) })
    await expect(page.getByRole('status')).toContainText('restored on this device')
  }
  await page.getByRole('button', { name: /Saved offers/ }).click()
  await openDisclosure(page, '.sharing-panel')
  await openDisclosure(page, '.sharing-panel')
  await page.getByLabel('Collection access key').fill('e2e-local-only')
}
async function agree(page: Page) {
  await page.getByRole('checkbox', { name: checkbox }).check()
  await page.getByRole('button', { name: 'Accept data sharing', exact: true }).click()
  await expect(page.getByText('Sharing consent active.', { exact: false })).toBeVisible()
}
test('explicit agreement records exact text and dates, survives reload, and withdrawal blocks replay', async ({ page, request }) => {
  const gameRequests: string[] = []
  page.on('request', request => { if (request.url().endsWith('/api/observations')) gameRequests.push(request.url()) })
  await openSharing(page)
  await expect(page.getByRole('checkbox', { name: checkbox })).not.toBeChecked()
  await expect(page.getByRole('button', { name: 'Accept data sharing' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Share', exact: true })).toBeDisabled()
  await expect(page.getByLabel('Consent information')).toHaveValue(consentText('observations', 'http://127.0.0.1:8790'))
  expect(gameRequests).toHaveLength(0)
  await agree(page)
  expect(gameRequests).toHaveLength(0)
  const submission = page.waitForRequest(request => request.url().endsWith('/api/observations'))
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  const sent = await submission
  await expect(page.getByRole('status')).toContainText('Reviewed offer shared')
  await page.reload()
  await page.getByRole('button', { name: /Saved offers/ }).click()
  await openDisclosure(page, '.sharing-panel')
  await expect(page.getByText('Sharing consent active.', { exact: false })).toBeVisible()
  await expect(page.getByLabel('Collection access key')).toHaveValue('')
  await page.getByRole('button', { name: 'Withdraw consent', exact: true }).click()
  await page.getByText('Consent history (1)', { exact: true }).click()
  await expect(page.getByText('Withdrawn on server', { exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Consent withdrawn', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open', exact: true })).toBeVisible()
  expect((await request.post('/api/observations', { headers: sent.headers(), data: sent.postDataJSON() })).status()).toBe(403)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export consent history' }).click()
  const records = JSON.parse(await readFile(await (await download).path(), 'utf8'))
  expect(records[0]).toMatchObject({ text: consentText('observations', 'http://127.0.0.1:8790'), acceptedAt: expect.any(String), recordedAt: expect.any(String), withdrawnAt: expect.any(String), withdrawalConfirmedAt: expect.any(String) })
  expect(records[0]).not.toHaveProperty('token')
  await expect(page.getByRole('checkbox', { name: checkbox })).not.toBeChecked()
})
test('offline withdrawal stops sharing immediately and retries after reload without the collection key', async ({ page }) => {
  await openSharing(page); await agree(page)
  await page.route('**/api/consents/*/withdraw', route => route.abort('internetdisconnected'))
  await page.getByRole('button', { name: 'Withdraw consent', exact: true }).click()
  await expect(page.getByText('Sharing stopped locally.', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Share', exact: true })).toBeDisabled()
  await page.reload()
  await page.getByRole('button', { name: /Saved offers/ }).click()
  await openDisclosure(page, '.sharing-panel')
  await expect(page.getByLabel('Collection access key')).toHaveValue('')
  await expect(page.getByText('Sharing stopped locally.', { exact: false })).toBeVisible()
  await page.unroute('**/api/consents/*/withdraw')
  await page.getByRole('button', { name: 'Retry withdrawal', exact: true }).click()
  await page.getByText('Consent history (1)', { exact: true }).click()
  await expect(page.getByText('Withdrawn on server', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Share', exact: true })).toBeDisabled()
})
test('a lost or invalid consent receipt keeps gameplay uploads disabled and can still be withdrawn', async ({ page }) => {
  await openSharing(page)
  await page.route('**/api/consents', async route => {
    const response = await route.fetch()
    await route.fulfill({ response, json: { ...await response.json(), id: 'wrong-id' } })
  })
  await page.getByRole('checkbox', { name: checkbox }).check()
  await page.getByRole('button', { name: 'Accept data sharing' }).click()
  await expect(page.getByText('Unexpected consent receipt.', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Share', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Withdraw consent', exact: true }).click()
  await page.getByText('Consent history (1)', { exact: true }).click()
  await expect(page.getByText('Withdrawn on server', { exact: true })).toBeVisible()
})
test('withdrawal in one tab disables sharing in another tab', async ({ page, context }) => {
  await openSharing(page); await agree(page)
  const other = await context.newPage()
  await other.goto('/')
  await other.getByRole('button', { name: /Saved offers/ }).click()
  await openDisclosure(other, '.sharing-panel')
  await openDisclosure(other, '.sharing-panel')
  await other.getByLabel('Collection access key').fill('e2e-local-only')
  await expect(other.getByRole('button', { name: 'Share', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Withdraw consent', exact: true }).click()
  await expect(other.getByRole('button', { name: 'Share', exact: true })).toBeDisabled()
  await expect(other.getByRole('checkbox', { name: checkbox })).not.toBeChecked()
})
test('unavailable consent storage fails closed and does not send consent or offer data', async ({ page }) => {
  await page.addInitScript(() => {
    const set = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('fate-collector.consent.')) throw new DOMException('Storage unavailable', 'QuotaExceededError')
      return set.call(this, key, value)
    }
  })
  const writes: string[] = []
  page.on('request', request => { if (request.method() === 'POST') writes.push(request.url()) })
  await openSharing(page)
  await page.getByRole('checkbox', { name: checkbox }).check()
  await page.getByRole('button', { name: 'Accept data sharing' }).click()
  await expect(page.getByText('Storage unavailable', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Share', exact: true })).toBeDisabled()
  expect(writes).toHaveLength(0)
})

test('a failed withdrawal audit save disables sharing across reload and can be retried from history', async ({ page }) => {
  await openSharing(page); await agree(page)
  await page.evaluate(() => {
    const set = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('fate-collector.consent.')) throw new DOMException('Storage unavailable', 'QuotaExceededError')
      return set.call(this, key, value)
    }
  })
  await page.getByRole('button', { name: 'Withdraw consent', exact: true }).click()
  await expect(page.getByText('Storage unavailable', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Share', exact: true })).toBeDisabled()
  await page.reload()
  await page.getByRole('button', { name: /Saved offers/ }).click()
  await openDisclosure(page, '.sharing-panel')
  await openDisclosure(page, '.sharing-panel')
  await page.getByLabel('Collection access key').fill('e2e-local-only')
  await expect(page.getByRole('button', { name: 'Share', exact: true })).toBeDisabled()
  await page.getByText('Consent history (1)', { exact: true }).click()
  await page.getByRole('button', { name: 'Withdraw this consent', exact: true }).click()
  await expect(page.getByText('Withdrawn on server', { exact: true })).toBeVisible()
})

test('consent actions and expanded history fit a narrow phone', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await openSharing(page); await agree(page)
  await page.getByRole('button', { name: 'Withdraw consent', exact: true }).click()
  await page.getByText('Consent history (1)', { exact: true }).click()
  await expect(page.getByText('Withdrawn on server', { exact: true })).toBeVisible()
  await page.getByText('Accepted text', { exact: true }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360)
  await expect(page.getByRole('button', { name: 'Export consent history' })).toBeVisible()
})
