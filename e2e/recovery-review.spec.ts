import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { newCard, newOffer, newReward } from '../shared/offers'
import type { Archive } from '../shared/schema'

async function sampleEntry(): Promise<Archive['offers'][number]> {
  const captureId = crypto.randomUUID()
  return { offer: { ...newOffer(), captureId, revision: 4, notes: 'Keep these corrections', cards: [
    { ...newCard(), name: 'Torchbearer', tier: 2, rewards: [{ ...newReward(), label: 'Item Rarity', visualId: 'gold-ring' }], visualReview: { version: 'test', tierReviewed: false, rewardsReviewed: false } },
    { ...newCard(), name: 'Tempest', tier: 2, rewards: [{ ...newReward(), label: "Dreadmaidens' Sacrament", visualId: 'orange-feathers', kind: 'combo', threshold: 2, identified: true }], visualReview: { version: 'test', tierReviewed: false, rewardsReviewed: false } },
  ] }, evidence: { id: captureId, imageDataUrl: `data:image/png;base64,${(await readFile('prototypes/vision/fixtures/images/press-offer-b.png')).toString('base64')}`,
    ocrText: 'Original OCR preserved', ocrLines: [], ocrStatus: 'ok', helperVersion: '0.3.3' } }
}
async function restore(page: Page, entries: Archive['offers']) {
  await page.getByLabel('Import capture file').setInputFiles({ name: 'archive.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ kind: 'fate-collector.export', schemaVersion: 1, offers: entries })) })
  await expect(page.getByRole('button', { name: new RegExp(`^Saved offers\\s*${entries.length}$`) })).toBeVisible()
}

test('a damaged journal record cannot hide readable offers or prevent their backup', async ({ page }) => {
  await page.goto('/')
  const good = await sampleEntry(), bad = await sampleEntry(), badId = bad.offer.id
  await restore(page, [good])
  const damaged = { offer: { ...bad.offer, revision: 'damaged' }, uploadedRevision: null, uploadedAt: null }
  await page.evaluate(async ({ record, evidence }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('fate-collector', 3)
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
    })
    const transaction = database.transaction(['offers', 'evidence'], 'readwrite')
    transaction.objectStore('offers').put(record)
    transaction.objectStore('evidence').put(evidence)
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error) })
    database.close()
  }, { record: damaged, evidence: bad.evidence })
  await page.reload()
  await page.getByRole('button', { name: /Saved offers/ }).click()
  await expect(page.getByRole('region', { name: 'Storage recovery' })).toContainText('1 unreadable offer(s)')
  await expect(page.getByRole('button', { name: 'Open', exact: true })).toHaveCount(1)
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export recovery data', exact: true }).click()
  const download = await pending
  const data = JSON.parse(await readFile(await download.path(), 'utf8'))
  expect(data.records[0].value).toEqual(damaged)
  expect(data.evidence).toContainEqual({ key: bad.offer.captureId, value: bad.evidence })
  await page.getByRole('button', { name: 'Export all data' }).click()
  await expect(page.getByRole('dialog')).toContainText('1 unreadable offer(s) excluded')
  await page.keyboard.press('Escape')
  await page.reload()
  await page.getByRole('button', { name: /Saved offers/ }).click()
  await expect(page.getByRole('region', { name: 'Storage recovery' })).toContainText('1 unreadable offer(s)')
  page.once('dialog', dialog => dialog.accept())
  await page.getByText('Unreadable records', { exact: true }).click()
  await page.getByRole('button', { name: 'Isolate original', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Storage recovery' })).toContainText('1 isolated original')
  const isolatedDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export recovery data', exact: true }).click()
  const recovered = JSON.parse(await readFile(await (await isolatedDownload).path(), 'utf8'))
  expect(recovered.records).toEqual([])
  expect(recovered.isolated).toContainEqual({ id: expect.stringMatching(/^recovery-offer:/), key: badId, value: damaged })
  expect(recovered.evidence).toContainEqual({ key: bad.offer.captureId, value: bad.evidence })
})

test('full backup downloads and restores images, OCR and revisions; metadata export omits evidence', async ({ page, browser }) => {
  await page.goto('/')
  const entries = [await sampleEntry(), await sampleEntry()]
  await restore(page, entries)
  for (const mode of ['full', 'data']) {
    await page.getByLabel('Backup contents').selectOption(mode)
    await page.getByRole('button', { name: 'Export all data' }).click()
    const dialog = page.getByRole('dialog', { name: 'Download your backup' })
    const downloads = dialog.getByRole('link')
    await expect(downloads.first()).toBeVisible()
    const fresh = await browser.newContext(), restored = await fresh.newPage()
    try {
      await restored.goto('/')
      const exported = []
      for (let index = 0; index < await downloads.count(); index++) {
        const pending = page.waitForEvent('download')
        await downloads.nth(index).click()
        const download = await pending, bytes = await readFile(await download.path())
        exported.push(...JSON.parse(bytes.toString()).offers)
        await restored.getByLabel('Import capture file').setInputFiles({ name: download.suggestedFilename(), mimeType: 'application/json', buffer: bytes })
        await expect(restored.getByRole('status')).toContainText('Imported')
      }
      const expected = entries.map(entry => ({ ...entry, evidence: mode === 'full' ? entry.evidence : null }))
      const byId = (a: Archive['offers'][number], b: Archive['offers'][number]) => a.offer.id.localeCompare(b.offer.id)
      expect(exported.sort(byId)).toEqual(expected.sort(byId))
      await expect(restored.getByText('Revision 4', { exact: true })).toHaveCount(2)
      await restored.getByRole('button', { name: 'Open', exact: true }).first().click()
      if (mode === 'full') {
        await expect(restored.getByAltText('Captured Fate offer')).toBeVisible()
        await restored.getByText('Edit details', { exact: true }).click()
        await restored.getByText('Original OCR text', { exact: true }).click()
        await expect(restored.getByText('Original OCR preserved', { exact: true })).toBeVisible()
      } else await expect(restored.getByAltText('Captured Fate offer')).toHaveCount(0)
    } finally { await fresh.close() }
    await page.keyboard.press('Escape')
  }
})

for (const width of [1440, 768, 390]) {
  test(`reward review keeps source visible, keyboard shortcuts and independent confirmations at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    const errors: string[] = [], posts: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    page.on('request', request => { if (request.method() === 'POST') posts.push(request.url()) })
    await page.goto('/')
    await expect(page).toHaveTitle(/Fate Collector/)
    await restore(page, [await sampleEntry()])
    await page.getByText('Edit details', { exact: true }).click()
    await expect(page.getByAltText('Reference capture for the selected Fate')).toBeVisible()
    const shortcut = page.getByRole('button', { name: 'Review reward 1: Item Rarity', exact: true })
    await expect(shortcut.locator('img')).toBeVisible()
    await shortcut.focus(); await page.keyboard.press('Enter')
    await expect(page.getByRole('group', { name: 'Reward 1', exact: true })).toBeFocused()
    await page.getByLabel('Tooltip catalog').selectOption('item-rarity')
    await expect(page.getByLabel('I checked this tier against the image')).not.toBeChecked()
    await expect(page.getByLabel('I checked all reward icons, kinds, counts and thresholds')).not.toBeChecked()
    await page.getByLabel('I checked this tier against the image').check()
    await page.getByLabel('I checked all reward icons, kinds, counts and thresholds').check()
    await page.getByRole('button', { name: 'Next card to review' }).click()
    await expect(page.getByRole('heading', { name: 'Reviewing Tempest' })).toBeFocused()
    await expect(page.getByLabel('I checked this tier against the image')).not.toBeChecked()
    await expect(page.getByLabel('I checked all reward icons, kinds, counts and thresholds')).not.toBeChecked()
    await expect(page.getByRole('button', { name: 'Next card to review' })).toBeDisabled()
    await page.getByRole('button', { name: 'Enlarge review screenshot' }).click()
    await expect(page.getByRole('dialog', { name: 'Review screenshot' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Enlarge review screenshot' })).toBeFocused()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByRole('heading', { name: 'Reviewing Tempest' }).scrollIntoViewIfNeeded()
    if (process.env.FATE_QA_DIR) await page.screenshot({ path: join(process.env.FATE_QA_DIR, `reward-review-${width}.png`) })
    expect(errors).toEqual([]); expect(posts).toEqual([])
  })
}
