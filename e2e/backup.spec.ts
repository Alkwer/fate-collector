import { openPanel, closePanels } from './ui'
import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { newOffer, newCard } from '../shared/offers'
import { MAX_IMPORT_BYTES, exportSchema } from '../shared/schema'

for (const width of [1440, 390]) {
  test(`journal backup parts download and restore at ${width}px`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 900 })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await page.goto('/')
    await expect(page).toHaveTitle(/Fate Collector/)
    const entries = Array.from({ length: 240 }, () => ({ offer: { ...newOffer(), notes: 'Keep my correction', revision: 4,
      cards: [{ ...newCard(), name: 'Alchemist', modifiers: Array(30).fill('ą'.repeat(1000)) }] }, evidence: null }))
    // Both initial inputs respect the existing import limit. Their combined
    // journal exceeds that limit and must be exported in independent parts.
    for (const batch of [entries.slice(0, 120), entries.slice(120)]) {
      await closePanels(page)
      await page.getByLabel('Import capture file').setInputFiles({ name: 'batch.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ kind: 'fate-collector.export', schemaVersion: 1, offers: batch })) })
      await expect(page.locator('.notice[role="status"]')).toContainText('Imported 120 new offers')
    }
    await expect(page.getByRole('button', { name: /^Saved offers\s*240$/ })).toBeVisible()
    await openPanel(page, '.archive-tools')
    await page.getByRole('button', { name: 'Export all offers' }).click()
    const dialog = page.getByRole('dialog', { name: 'Download your backup' })
    await expect(dialog).toBeVisible()
    const links = dialog.getByRole('link')
    await expect(links).toHaveCount(2)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    if (process.env.FATE_QA_DIR) await page.screenshot({ path: join(process.env.FATE_QA_DIR, `backup-${width}.png`), fullPage: false })
    const restored = []
    const fresh = await context.browser()!.newContext()
    const other = await fresh.newPage()
    try {
      await other.goto('/')
      for (let index = 0; index < await links.count(); index++) {
        const pending = page.waitForEvent('download')
        await links.nth(index).click()
        const download = await pending, bytes = await readFile(await download.path())
        expect(bytes.byteLength).toBeLessThanOrEqual(MAX_IMPORT_BYTES)
        restored.push(...exportSchema.parse(JSON.parse(bytes.toString('utf8'))).offers)
        await closePanels(other)
        await other.getByLabel('Import capture file').setInputFiles({ name: download.suggestedFilename(), mimeType: 'application/json', buffer: bytes })
        await expect(other.locator('.notice[role="status"]')).toContainText('Imported')
      }
      const byId = (a: { offer: { id: string } }, b: { offer: { id: string } }) => a.offer.id.localeCompare(b.offer.id)
      expect(restored.sort(byId)).toEqual([...entries].sort(byId))
      await expect(other.getByRole('button', { name: /^Saved offers\s*240$/ })).toBeVisible()
      await expect(other.getByText('Revision 4', { exact: true })).toHaveCount(240)
    } finally { await fresh.close() }
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    expect(errors).toEqual([])
  })
}
