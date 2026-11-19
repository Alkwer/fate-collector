import { expect, test, type Page } from '@playwright/test'
import { newCard, newOffer, newReward } from '../shared/offers'
import { closePanels, openPanel } from './ui'
import { createFightJournalBackup, journalStorageKey, type FightEntry, type FightJournal } from '../src/lib/fight-journal'

async function bringOffer(page: Page) {
  const offer = { ...newOffer(), origin: 'live', area: 'Sanctuary', gameVersion: '3.30.0b', cards: [{
    ...newCard(), name: 'Dryad', tier: 3,
    rewards: [{ ...newReward(), label: 'Rare Map', kind: 'regular', identified: true }],
  }] }
  await page.getByLabel('Import capture file').setInputFiles({ name: 'fight.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(offer)) })
  await closePanels(page)
  await page.getByRole('button', { name: 'Start area with this offer', exact: true }).click()
}

test('previews and restores a fight backup without overwriting conflicts', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const fight: FightEntry = {
    invocation: {
      id: crypto.randomUUID(), areaId: crypto.randomUUID(), invokedAt: '2026-11-18T17:00:00Z',
      mapName: 'Sanctuary', gameVersion: '3.30.0b', modeledPreview: '', inputs: [{ name: 'Dryad', tier: 3 }],
    },
    outcome: { mapName: 'Sanctuary', gameVersion: '3.30.0b', gamePreview: '', boss: 'Local boss', bossStatus: 'killed', loot: { status: 'none' } },
  }
  const local: FightJournal = { entries: [fight], goal: { kind: 'profit', objective: 'maps' }, progress: { 'profit:maps': 3 } }
  const newFight = { ...fight, invocation: { ...fight.invocation, id: crypto.randomUUID() }, outcome: { ...fight.outcome, boss: 'New boss' } }
  const imported = createFightJournalBackup({
    entries: [{ ...fight, outcome: { ...fight.outcome, boss: 'Different boss' } }, newFight],
    goal: { kind: 'omen', map: 'Sanctuary' }, progress: { 'profit:maps': 10, 'omen:Sanctuary': 1 },
  })
  await page.goto('/')
  await page.evaluate(({ key, journal }) => localStorage.setItem(key, JSON.stringify(journal)), { key: journalStorageKey, journal: local })
  await page.reload()
  await openPanel(page, '.fight-journal')
  await page.getByRole('button', { name: 'Back up or restore' }).click()
  const panel = page.getByRole('dialog', { name: 'Fight journal backup' })
  await expect(panel.getByRole('heading', { name: 'Fight journal backup' })).toBeFocused()
  const downloadEvent = page.waitForEvent('download')
  await panel.getByRole('button', { name: 'Export fight journal' }).click()
  const download = await downloadEvent
  expect(download.suggestedFilename()).toBe('fate-collector-fight-journal.json')
  const bytes = []
  for await (const chunk of await download.createReadStream()) bytes.push(chunk)
  expect(JSON.parse(Buffer.concat(bytes).toString())).toEqual(createFightJournalBackup(local))

  const source = { name: 'fight-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) }
  await panel.getByLabel('Fight journal backup file').setInputFiles(source)
  await expect(panel).toContainText('1 new fight and 1 new challenge progress value')
  await expect(panel).toContainText('1 conflicting fight, 1 conflicting challenge progress value, the selected league goal')
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), journalStorageKey)).toEqual(local)
  await panel.screenshot({ path: info.outputPath('fight-import-preview.png') })
  await panel.getByRole('button', { name: 'Import data without conflicts' }).click()
  await expect(panel).toContainText('Backup imported. Your local values were kept for conflicts.')
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), journalStorageKey)).toEqual({
    ...local, entries: [fight, newFight], progress: { ...local.progress, 'omen:Sanctuary': 1 },
  })
  await page.keyboard.press('Escape')
  const journal = page.getByRole('dialog', { name: 'Fight journal', exact: true })
  await journal.getByLabel('Boss name').fill('First draft')
  await journal.getByRole('combobox', { name: 'Fight', exact: true }).selectOption(newFight.invocation.id)
  await journal.getByLabel('Boss name').fill('Second draft')
  await journal.getByRole('combobox', { name: 'Fight', exact: true }).selectOption(fight.invocation.id)
  await expect(journal.getByLabel('Boss name')).toHaveValue('First draft')
  await journal.getByRole('button', { name: 'Discard edits' }).click()
  await expect(journal.getByLabel('Boss name')).toHaveValue('Local boss')
  await journal.getByRole('combobox', { name: 'Fight', exact: true }).selectOption(newFight.invocation.id)
  await expect(journal.getByLabel('Boss name')).toHaveValue('Second draft')
  await journal.getByRole('button', { name: 'Back up or restore' }).click()
  await panel.getByLabel('Fight journal backup file').setInputFiles(source)
  await expect(panel).toContainText('There is no new data to import.')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Back up or restore' })).toBeFocused()
})

test('logs observed results in both invocation paths, undoes the matching outcome and restores retained entries', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await bringOffer(page)
  await page.getByRole('button', { name: 'Add Dryad to collected', exact: true }).click()
  await page.getByRole('button', { name: 'Plan invocation', exact: true }).click()
  await page.getByRole('button', { name: 'Mark this invocation completed', exact: true }).first().click()
  await page.getByRole('button', { name: 'Log fight outcome', exact: true }).click()
  const journal = page.getByRole('dialog', { name: 'Fight journal', exact: true })
  await expect(journal).toContainText('Advisor preview')
  await expect(journal.getByLabel('Game version')).toHaveValue('3.30.0b')
  await expect(journal.getByLabel('Map or area')).toHaveValue('Sanctuary')
  await expect(journal.getByLabel('Loot observed')).toHaveValue('unchecked')
  await journal.getByLabel('Loot observed').selectOption('items')
  await expect(journal.getByRole('button', { name: 'Save fight outcome' })).toBeDisabled()
  await journal.getByLabel('Items and quantities').fill('1 Rare Map')
  await journal.getByLabel('Boss name').fill('Unsaved boss')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Log fight outcome', exact: true }).click()
  await expect(journal.getByLabel('Boss name')).toHaveValue('Unsaved boss')
  await expect(journal.getByLabel('Items and quantities')).toHaveValue('1 Rare Map')
  await journal.getByLabel('Invocation preview in game').fill('Additional Rare Map')
  await journal.getByLabel('Boss killed').selectOption('killed')
  await journal.getByRole('button', { name: 'Save fight outcome' }).click()
  await expect(page.getByText('Fight outcome saved locally.')).toBeVisible()

  await page.getByRole('button', { name: 'Undo collection change', exact: true }).click()
  await expect(page.getByRole('complementary')).toContainText('1/12')
  await page.getByRole('button', { name: 'Fight journal', exact: true }).click()
  await expect(journal).toContainText('After recording an invocation')
  await closePanels(page)

  await page.getByRole('button', { name: 'Record a different invocation', exact: true }).click()
  await page.getByRole('checkbox', { name: '1. Dryad · Tier 3' }).check()
  await page.getByRole('button', { name: 'Record used Fates', exact: true }).click()
  await page.getByRole('button', { name: 'Log fight outcome', exact: true }).click()
  await expect(journal.getByText(/Advisor preview/)).toHaveCount(0)
  await journal.getByLabel('Loot observed').selectOption('none')
  await journal.getByRole('button', { name: 'Save fight outcome' }).click()
  await page.reload()
  await openPanel(page, '.fight-journal')
  await expect(journal.getByLabel('Loot observed')).toHaveValue('none')
  await expect(journal.getByLabel('Boss killed')).toHaveValue('unknown')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('challenge goals suggest eligible choices without incrementing progress and start a fresh area unconfirmed', async ({ page }) => {
  await page.goto('/')
  await bringOffer(page)
  await openPanel(page, '.league-challenge')
  const challenge = page.getByRole('dialog', { name: 'League challenge goals', exact: true })
  await challenge.getByLabel('Challenge objective').selectOption('profit:maps')
  await closePanels(page)
  await expect(page.getByText(/Choices with a modeled Promised Profits match: Dryad/)).toBeVisible()
  await openPanel(page, '.league-challenge')
  await challenge.getByLabel(/Progress shown in game/).fill('8')
  await challenge.getByRole('button', { name: 'Save confirmed progress' }).click()
  await challenge.getByLabel('Challenge objective').selectOption('omen:Sanctuary')
  await closePanels(page)
  await expect(page.getByText(/Check the map requirements for Overpowering Omens/)).toBeVisible()
  await openPanel(page, '.league-challenge')
  await challenge.getByLabel(/I checked that this area/).check()
  await closePanels(page)
  await expect(page.getByText(/Tier 3 choices for Overpowering Omens: Dryad/)).toBeVisible()
  await page.getByRole('button', { name: 'Add Dryad to collected', exact: true }).click()
  await page.getByRole('button', { name: 'Plan invocation', exact: true }).click()
  await page.getByRole('button', { name: 'Mark this invocation completed', exact: true }).first().click()
  await openPanel(page, '.league-challenge')
  await expect(challenge.getByLabel('Marked complete in game')).not.toBeChecked()
  await expect(challenge.getByText(/0\/12 maps confirmed/)).toBeVisible()
  await closePanels(page)
  await openPanel(page, '.more-actions')
  await page.getByRole('button', { name: 'New area', exact: true }).click()
  await openPanel(page, '.league-challenge')
  await expect(challenge.getByLabel(/I checked that this area/)).not.toBeChecked()
  await challenge.getByLabel('Challenge objective').selectOption('profit:maps')
  await expect(challenge.getByLabel(/Progress shown in game/)).toHaveValue('8')
  await closePanels(page)
  await expect(page.getByRole('button', { name: 'Log fight outcome' })).toBeVisible()
})
