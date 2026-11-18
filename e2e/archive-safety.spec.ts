import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { newCard, newOffer } from '../shared/offers'
import { closePanels, openPanel } from './ui'

async function loadExample(page: Page) {
  await openPanel(page, '.more-actions')
  await page.getByRole('button', { name: 'Load example', exact: true }).click()
}

async function importOffer(page: Page, offer: ReturnType<typeof newOffer>) {
  await page.getByLabel('Import capture file').setInputFiles({ name: 'archived-offer.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(offer)) })
  await expect(page.getByRole('heading', { name: 'Archived offer', exact: true })).toBeVisible()
}

test('journal prevents single deletion while either editor has unsaved changes', async ({ page }) => {
  await page.goto('/')
  await loadExample(page)
  await page.getByRole('button', { name: 'Save offer', exact: true }).click()
  await expect(page.getByText('Offer saved on this device.', { exact: false })).toBeVisible()
  await openPanel(page, '.advanced-panel')
  await page.getByRole('textbox', { name: 'Notes', exact: true }).fill('Keep current-area correction')
  await closePanels(page)

  const archived = { ...newOffer(), cards: [{ ...newCard(), name: 'Dryad' }] }
  await importOffer(page, archived)
  await openPanel(page, '.advanced-panel')
  await page.getByRole('textbox', { name: 'Notes', exact: true }).fill('Keep archived correction')
  await closePanels(page)
  await page.getByRole('button', { name: /Saved offers/ }).click()

  const mutable = page.getByRole('row').filter({ hasText: 'Unsaved changes' })
  await expect(mutable).toHaveCount(2)
  for (const row of await mutable.all()) await expect(row.getByRole('button', { name: 'Delete', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Resume archived review' }).click()
  await openPanel(page, '.advanced-panel')
  await expect(page.getByRole('textbox', { name: 'Notes', exact: true })).toHaveValue('Keep archived correction')
  await closePanels(page)
  await page.getByRole('button', { name: 'Current area', exact: true }).click()
  await openPanel(page, '.advanced-panel')
  await expect(page.getByRole('textbox', { name: 'Notes', exact: true })).toHaveValue('Keep current-area correction')
})

test('single deletion rejects a revision updated after the journal last read it', async ({ page }) => {
  await page.goto('/')
  const offer = { ...newOffer(), cards: [{ ...newCard(), name: 'Dryad' }] }
  await importOffer(page, offer)
  await page.getByRole('button', { name: /Saved offers/ }).click()
  await expect(page.getByText('Revision 1', { exact: true })).toBeVisible()
  await page.evaluate(id => new Promise<void>((resolve, reject) => {
    const connection = indexedDB.open('fate-collector')
    connection.onerror = () => reject(connection.error)
    connection.onsuccess = () => {
      const db = connection.result, transaction = db.transaction('offers', 'readwrite'), store = transaction.objectStore('offers')
      transaction.oncomplete = () => { db.close(); resolve() }
      transaction.onabort = () => { db.close(); reject(transaction.error) }
      const read = store.get(id)
      read.onsuccess = () => store.put({ ...read.result, offer: { ...read.result.offer, revision: 2, notes: 'Correction saved elsewhere' } })
    }
  }), offer.id)
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Nothing was removed')
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await openPanel(page, '.advanced-panel')
  await expect(page.getByRole('textbox', { name: 'Notes', exact: true })).toHaveValue('Correction saved elsewhere')
})

for (const { width, archived } of [{ width: 1440, archived: false }, { width: 390, archived: true }]) {
  test(`invalid draft fields download privately at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')
    if (archived) await importOffer(page, { ...newOffer(), cards: [{ ...newCard(), name: 'Alchemist' }] })
    else await loadExample(page)
    const writes: string[] = []
    page.on('request', request => { if (request.method() === 'POST') writes.push(request.url()) })
    await openPanel(page, '.advanced-panel')
    const editor = page.getByRole('dialog', { name: 'Edit details' })
    await editor.getByRole('button', { name: 'Alchemist', exact: true }).click()
    const lines = Array.from({ length: 41 }, (_, index) => `Keep modifier ${index + 1}`)
    const modifiers = editor.getByRole('textbox', { name: 'Modifiers', exact: true })
    await modifiers.fill(lines.join('\n'))
    await expect(modifiers).toHaveAttribute('aria-invalid', 'true')
    const downloadAction = editor.getByRole('button', { name: 'Download private draft' })
    await expect(downloadAction).toBeInViewport()
    const pending = page.waitForEvent('download')
    await downloadAction.click()
    const download = await pending
    const bytes = await readFile(await download.path())
    const file = JSON.parse(bytes.toString('utf8'))
    expect(download.suggestedFilename()).toMatch(/^fate-private-draft-.*\.json$/)
    expect(file.kind).toBe('fate-collector.draft-recovery')
    expect(file).not.toHaveProperty('evidence')
    expect(file.offer.cards[0].modifiers).toEqual(lines)
    expect(writes).toEqual([])
    await expect(modifiers).toHaveValue(lines.join('\n'))
    await closePanels(page)
    await page.getByLabel('Import capture file').setInputFiles({ name: download.suggestedFilename(), mimeType: 'application/json', buffer: bytes })
    await expect(page.getByText(/This private draft contains working data for manual recovery/)).toBeVisible()
  })
}
