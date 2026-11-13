import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFile } from 'node:fs/promises'
import { closePanels, openPanel } from './ui'
import { newOffer, newCard } from '../shared/offers'

test('guided practice reaches collection and invocation without claiming live evidence', async ({ page }) => {
  await page.goto('/')
  await openPanel(page, '.more-actions')
  await page.getByRole('button', { name: 'Load guided practice', exact: true }).click()
  await page.getByRole('button', { name: 'Start area with this offer', exact: true }).click()
  await expect(page.locator('.advisor-outcome')).toContainText('Alchemist')
  await page.getByRole('button', { name: 'Add Alchemist to collected', exact: true }).click()
  await page.getByRole('button', { name: 'Plan this collection', exact: true }).first().click()
  await expect(page.getByRole('button', { name: 'Mark this invocation completed', exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Mark this invocation completed', exact: true }).first().click()
  await expect(page.getByText('No collected Fates yet.', { exact: true })).toBeVisible()
  await expect(page.locator('.save-state')).toContainText('Test capture')
})

test('unknown rewards show known gain and unresolved totals', async ({ page }) => {
  await page.goto('/'); await openPanel(page, '.more-actions')
  await page.getByRole('button', { name: 'Load example', exact: true }).click()
  await page.getByRole('button', { name: 'Start area with this offer', exact: true }).click()
  await expect(page.locator('.candidate-gain').first()).toContainText('Total unresolved')
  await expect(page.locator('.candidate-gain').first()).toContainText('Known gain')
  await expect(page.locator('.candidate-gain').getByText('No gain', { exact: true })).toHaveCount(0)
})

test('import comparison explicitly replaces a correction and preserves its previous original', async ({ page }) => {
  await page.goto('/'); await openPanel(page, '.more-actions')
  await page.getByRole('button', { name: 'Load example', exact: true }).click()
  await page.getByRole('button', { name: 'Save offer', exact: true }).click()
  await openPanel(page, '.more-actions')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click()
  const content = JSON.parse(await readFile((await (await download).path())!, 'utf8'))
  content.offers[0].offer.notes = 'Imported correction for explicit review'
  content.offers[0].offer.revision += 4
  await page.getByLabel('Import capture file').setInputFiles({ name: 'correction.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(content)) })
  await expect(page.getByRole('dialog', { name: 'Compare imported corrections' })).toBeVisible()
  await page.getByRole('button', { name: 'Use imported correction', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Compare imported corrections' })).toBeHidden()
  await openPanel(page, '.advanced-panel')
  await expect(page.getByRole('textbox', { name: 'Notes', exact: true })).toHaveValue('Imported correction for explicit review')
  await closePanels(page); await page.getByRole('button', { name: /Saved offers/ }).click()
  await expect(page.getByLabel('Storage recovery')).toContainText('1 isolated original')
})

test('a failed lazy view has a recovery screen and preserves downloadable offers', async ({ page }) => {
  await page.route('**/UsageGuide-*.js', route => route.abort())
  await page.goto('/'); await openPanel(page, '.more-actions')
  await page.getByRole('button', { name: 'Load example', exact: true }).click()
  await page.getByRole('button', { name: 'Save offer', exact: true }).click()
  await page.getByRole('button', { name: 'Guide', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Fate Collector could not display this screen.' })).toBeVisible()
  await page.getByRole('button', { name: 'Prepare recovery backup', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('1 readable offers prepared')
  await expect(page.getByRole('link', { name: /fate-collector-full-/ })).toBeVisible()
})

test('primary screens and editing pass targeted automated accessibility checks', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  for (const theme of ['mineral', 'trail']) {
    await page.evaluate(value => { localStorage.setItem('fate-collector.theme', value); document.documentElement.dataset.theme = value }, theme)
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([])
  }
  await openPanel(page, '.more-actions'); await page.getByRole('button', { name: 'Load guided practice', exact: true }).click()
  await page.getByRole('button', { name: 'Start area with this offer', exact: true }).click()
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([])
  await openPanel(page, '.advanced-panel')
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([])
})

test('250 offers can be selected, backed up and explicitly removed without losing the downloaded archive', async ({ page }) => {
  const offers = Array.from({ length: 250 }, (_, index) => ({ offer: { ...newOffer(), cards: [{ ...newCard(), name: 'Alchemist' }], notes: `Bulk archive fixture ${index}` }, evidence: null }))
  await page.goto('/')
  await page.getByLabel('Import capture file').setInputFiles({ name: 'bulk.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ kind: 'fate-collector.export', schemaVersion: 1, offers })) })
  await expect(page.getByRole('status')).toContainText('Imported 250 new offers')
  await page.getByRole('button', { name: 'Select filtered offers', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Delete selected offers', exact: true })).toBeDisabled()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export selected with evidence', exact: true }).click()
  await page.getByRole('link', { name: /fate-collector-full-/ }).click()
  const archive = JSON.parse(await readFile((await (await download).path())!, 'utf8'))
  expect(archive.offers).toHaveLength(250)
  expect(archive.offers.map((entry: typeof offers[number]) => entry.offer.id).sort()).toEqual(offers.map(entry => entry.offer.id).sort())
  await page.getByRole('dialog', { name: 'Download your backup' }).getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByLabel('I downloaded and checked a backup of these offers.').check()
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Delete selected offers', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'No offers here yet.' })).toBeVisible()
  await page.reload(); await page.getByRole('button', { name: 'Saved offers', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'No offers here yet.' })).toBeVisible()
})

test('a changed deployed revision offers refresh without replacing an unsaved draft', async ({ page }) => {
  await page.route('**/api/status', route => route.fulfill({ json: { ingestionEnabled: false, revision: 'f'.repeat(40), environment: 'local' } }))
  await page.goto('/'); await openPanel(page, '.more-actions')
  await page.getByRole('button', { name: 'Load example', exact: true }).click()
  await expect(page.getByLabel('Website update')).toContainText('Save or export open drafts')
  await expect(page.getByRole('button', { name: 'Save offer', exact: true })).toBeEnabled()
  await expect(page.getByRole('heading', { name: 'Alchemist', exact: true })).toBeVisible()
})
