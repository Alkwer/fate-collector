import { openPanel, closePanels, toggleEditor, expectEmptyMap, selectRewardGoal } from './ui'
import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { newCard, newOffer, newReward } from '../shared/offers'

const sample = () => ({ ...newOffer(), cards: [{ ...newCard(), name: 'Alchemist', tier: 2, rewards: [{ ...newReward(), label: 'Currency', kind: 'regular' as const, identified: true }] }] })
async function importData(page: Page, data: unknown) {
  await closePanels(page)
  await page.getByLabel('Import capture file').setInputFiles({ name: 'audit.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) })
  await expect(page.locator('.notice').first()).toContainText(/restored|Imported|read|preserved/i)
}
async function stored(page: Page, store: string, key: string) {
  return page.evaluate(async ({ store, key }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('fate-collector', 3); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    try { return await new Promise<any>((resolve, reject) => { const r = database.transaction(store).objectStore(store).get(key); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) }) }
    finally { database.close() }
  }, { store, key })
}

test('invalid image and malformed OCR preserve access to offer data and produce importable backups', async ({ page }) => {
  await page.goto('/')
  const offer = { ...sample(), captureId: crypto.randomUUID() }
  await importData(page, offer)
  for (const ocrText of ['Original OCR', 42]) {
    await page.evaluate(async ({ id, ocrText }) => {
      const database = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('fate-collector', 3); r.onsuccess = () => resolve(r.result) })
      const tx = database.transaction('evidence', 'readwrite')
      tx.objectStore('evidence').put({ id, imageDataUrl: 'data:image/png;base64,AAAA', ocrText, ocrLines: [], ocrStatus: 'ok', helperVersion: null })
      await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error) }); database.close()
    }, { id: offer.captureId, ocrText })
    await closePanels(page)
    await page.getByRole('button', { name: /Saved offers/ }).click()
    await page.getByRole('button', { name: 'Open', exact: true }).click()
    await closePanels(page)
    await expect(page.getByRole('heading', { name: 'Archived offer', exact: true })).toBeVisible()
    await expect(page.getByRole('alert')).toContainText('screenshot or OCR is damaged')
    await closePanels(page)
    await page.getByRole('button', { name: /Saved offers/ }).click()
    await openPanel(page, '.archive-tools')
    await page.getByRole('button', { name: 'Export all data' }).click()
    const dialog = page.getByRole('dialog', { name: 'Download your backup' })
    await expect(dialog).toContainText('1 damaged evidence record(s) excluded')
    const pending = page.waitForEvent('download'); await dialog.getByRole('link').click()
    const backup = JSON.parse(await readFile(await (await pending).path(), 'utf8'))
    expect(backup.offers).toEqual([{ offer, evidence: null }])
    await page.keyboard.press('Escape')
    expect((await stored(page, 'evidence', offer.captureId)).ocrText).toBe(ocrText)
    await importData(page, backup)
  }
})

test('crash recovery preserves unsaved corrections separately from saved revisions', async ({ page }) => {
  await page.goto('/')
  const offer = sample(); await importData(page, offer)
  await toggleEditor(page)
  await page.getByRole('textbox', { name: 'Notes', exact: true }).fill('Recover this unfinished correction')
  await expect.poll(async () => page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('fate-collector', 3); r.onsuccess = () => resolve(r.result) })
    try { return await new Promise<boolean>(resolve => { const r = database.transaction('settings').objectStore('settings').getAll(); r.onsuccess = () => resolve(r.result.some(item => item.value?.offer?.notes === 'Recover this unfinished correction')) }) } finally { database.close() }
  })).toBe(true)
  expect((await stored(page, 'offers', offer.id)).offer).toEqual(offer)
  page.on('dialog', dialog => dialog.accept())
  await page.reload()
  await page.getByRole('button', { name: 'Recover draft', exact: true }).click()
  await toggleEditor(page)
  await expect(page.getByRole('textbox', { name: 'Notes', exact: true })).toHaveValue('Recover this unfinished correction')
  expect((await stored(page, 'offers', offer.id)).offer.revision).toBe(offer.revision)
  await page.getByRole('button', { name: 'Save offer', exact: true }).click()
  await expect.poll(async () => (await stored(page, 'offers', offer.id)).offer.revision).toBe(offer.revision + 1)
})

test('completed invocations consume cards, undo restores them, and source corrections are explicit', async ({ page }) => {
  await page.goto('/')
  const offer = sample(); await importData(page, offer)
  await closePanels(page)
  await page.getByRole('button', { name: 'Start map with this offer', exact: true }).click()
  await closePanels(page)
  await page.getByRole('button', { name: 'Add Alchemist to collected', exact: true }).click()
  await selectRewardGoal(page, 'regular:currency')
  await closePanels(page)
  await page.getByRole('button', { name: 'Plan invocation', exact: true }).click()
  await page.getByRole('button', { name: 'Mark this invocation completed' }).first().click()
  await expect(page.getByText('No collected Fates yet.')).toBeVisible()
  await page.getByRole('button', { name: 'Choose a Fate', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Add Alchemist to collected', exact: true })).toBeDisabled()
  await closePanels(page)
  await page.getByRole('button', { name: 'Undo collection change' }).click()
  await expect(page.getByText('#1 Alchemist', { exact: true })).toBeVisible()
  await closePanels(page)
  await page.getByRole('button', { name: 'Edit current offer' }).click()
  await page.locator('.advanced-panel').getByLabel('Fate name', { exact: true }).fill('Updated Alchemist')
  await page.getByRole('button', { name: 'Save offer', exact: true }).click()
  await expect(page.getByText('#1 Alchemist', { exact: true })).toBeVisible()
  await closePanels(page)
  await page.getByRole('button', { name: 'Apply source correction: Alchemist' }).click()
  await expect(page.getByText('#1 Updated Alchemist', { exact: true })).toBeVisible()
  await openPanel(page, '.more-actions')
  await page.getByRole('button', { name: 'New map', exact: true }).click()
  await expectEmptyMap(page)
  await closePanels(page)
  await page.getByRole('button', { name: 'Undo collection change' }).click()
  await expect(page.getByText('#1 Updated Alchemist', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue this map' })).toBeVisible()
})

test('journal refreshes across tabs and filters without discarding an edited draft', async ({ page, context }) => {
  await page.goto('/')
  const offer = sample(); await importData(page, offer)
  await toggleEditor(page)
  await page.getByRole('textbox', { name: 'Notes', exact: true }).fill('Keep pending edit')
  const other = await context.newPage(); await other.goto('/')
  await closePanels(other)
  await other.getByRole('button', { name: /Saved offers/ }).click()
  const second = { ...sample(), area: 'Karui Shores', cards: [{ ...newCard(), name: 'Tempest' }] }
  await importData(other, second)
  await expect(page.getByRole('button', { name: /^Saved offers\s*2$/ })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Notes', exact: true })).toHaveValue('Keep pending edit')
  await closePanels(page)
  await page.getByRole('button', { name: /Saved offers/ }).click()
  await page.getByLabel('Search offers').fill('Karui')
  await expect(page.getByRole('button', { name: 'Open', exact: true })).toHaveCount(1)
  await expect(page.locator('.history-table')).toContainText('Tempest')
  await openPanel(page, '.filter-options')
  await page.getByRole('combobox', { name: 'Review', exact: true }).selectOption('reviewed')
  await expect(page.getByRole('heading', { name: 'No matching offers.' })).toBeVisible()
})
