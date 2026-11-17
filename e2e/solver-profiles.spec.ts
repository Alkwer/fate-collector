import { expect, test } from '@playwright/test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { newCard, newOffer, newReward } from '../shared/offers'
import { newSolverSettings, SOLVER_SETTINGS_KEY } from '../src/lib/solver-settings'
import { SOLVER_LIBRARY_KEY } from '../src/lib/solver-library'
import { closePanels, openPanel } from './ui'

const goal = 'Additional Currency Items'
const weightLabel = `${goal} regular weight`
async function rename(page: import('@playwright/test').Page, name: string) {
  await page.getByRole('textbox', { name: 'Profile name', exact: true }).fill(name)
  await page.getByRole('button', { name: 'Save name', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Active profile' }).locator('option:checked')).toHaveText(name)
}

for (const [width, theme] of [[1440, 'mineral'], [820, 'mineral'], [390, 'mineral'], [390, 'trail']] as const) {
  test(`build profiles keep settings and map independent at ${width}px in ${theme}`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', entry => { if (entry.type() === 'error') errors.push(entry.text()) })
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('/')
    await expect(page).toHaveTitle(/Fate Collector/)
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme)
    const offer = { ...newOffer(), cards: [{ ...newCard(), name: 'Alchemist', tier: 2, rewards: [{ ...newReward(), kind: 'regular', identified: true, label: goal, count: 2 }] }] }
    await page.getByLabel('Import capture file').setInputFiles({ name: 'profiles.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(offer)) })
    await page.getByRole('button', { name: 'Start area with this offer', exact: true }).click()
    await page.getByRole('button', { name: 'Add Alchemist to collected', exact: true }).click()
    const map = await page.evaluate(() => sessionStorage.getItem('fate-collector.advisor-area.v2'))
    await openPanel(page, '.reward-settings')
    const longName = 'Mapowanie — odporność na klątwy i obrażenia fizyczne'
    await rename(page, longName)
    await page.getByLabel(weightLabel).fill('17')
    await page.getByLabel('Bleeding action', { exact: true }).selectOption('warn')
    await page.getByLabel('Avoid modifiers containing').fill('reflect')
    await page.getByRole('button', { name: 'Apply modifier filters', exact: true }).click()
    await page.getByRole('combobox', { name: 'Planning objective', exact: true }).selectOption('viscera')
    await page.getByRole('button', { name: 'Duplicate profile', exact: true }).click()
    await expect(page.getByLabel(weightLabel)).toHaveValue('17')
    await rename(page, 'Boss / SSF')
    await page.getByLabel(weightLabel).fill('4')
    await page.getByRole('combobox', { name: 'Planning objective', exact: true }).selectOption('rewards')
    await page.getByLabel('Bleeding action', { exact: true }).selectOption('exclude')
    await page.getByLabel('Compare multiple rewards', { exact: true }).uncheck()
    await page.getByRole('combobox', { name: 'Reward goal', exact: true }).selectOption(`regular:${goal.toLowerCase()}`)
    await page.getByLabel('Import solver profile').setInputFiles({ name: 'legacy-profile.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...newSolverSettings(), mode: 'single' })) })
    await expect(page.getByRole('combobox', { name: 'Reward goal', exact: true })).toHaveValue(`regular:${goal.toLowerCase()}`)
    await page.getByLabel(weightLabel).fill('4')
    await page.getByRole('combobox', { name: 'Active profile', exact: true }).selectOption({ label: longName })
    await expect(page.getByLabel(weightLabel)).toHaveValue('17')
    await expect(page.getByRole('combobox', { name: 'Planning objective', exact: true })).toHaveValue('viscera')
    await expect(page.getByLabel('Bleeding action', { exact: true })).toHaveValue('warn')
    await expect(page.getByLabel('Avoid modifiers containing')).toHaveValue('reflect')
    await page.getByRole('combobox', { name: 'Active profile', exact: true }).selectOption({ label: 'Boss / SSF' })
    await expect(page.getByRole('combobox', { name: 'Reward goal', exact: true })).toHaveValue(`regular:${goal.toLowerCase()}`)
    await expect(page.getByLabel(weightLabel)).toHaveValue('4')
    expect(await page.evaluate(() => sessionStorage.getItem('fate-collector.advisor-area.v2'))).toBe(map)
    await page.getByRole('combobox', { name: 'Active profile', exact: true }).focus()
    await page.keyboard.press('ArrowUp')
    await expect(page.getByRole('combobox', { name: 'Active profile', exact: true }).locator('option:checked')).toHaveText(longName)
    await expect(page.getByRole('combobox', { name: 'Active profile', exact: true })).toBeFocused()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(await page.locator('.reward-settings .detail-dialog[open]').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.locator('.reward-settings .detail-body').evaluate(element => element.scrollTop = 0)
    await page.screenshot({ path: join(tmpdir(), `fate-profiles-${theme}-${width}.png`), fullPage: false })
    await page.reload()
    await page.getByRole('button', { name: 'Continue this area', exact: true }).click()
    await openPanel(page, '.reward-settings')
    await expect(page.getByLabel('Profile name', { exact: true })).toHaveValue(longName)
    await expect(page.getByLabel(weightLabel)).toHaveValue('17')
    await closePanels(page)
    await expect(page.getByRole('complementary')).toContainText('1/12')
    expect(errors).toEqual([])
  })
}

test('legacy settings migrate without overwriting the old profile', async ({ page }) => {
  const settings = { ...newSolverSettings(), profile: { goals: [{ kind: 'regular', label: goal, weight: 31 }], avoidModifiers: ['reflect'] } }
  const raw = JSON.stringify(settings)
  await page.addInitScript(({ key, raw }) => localStorage.setItem(key, raw), { key: SOLVER_SETTINGS_KEY, raw })
  await page.goto('/')
  await openPanel(page, '.reward-settings')
  await expect(page.getByLabel(weightLabel)).toHaveValue('31')
  await rename(page, 'Existing build')
  await page.reload()
  await openPanel(page, '.reward-settings')
  await expect(page.getByLabel('Profile name', { exact: true })).toHaveValue('Existing build')
  await expect(page.getByLabel(weightLabel)).toHaveValue('31')
  expect(await page.evaluate(key => localStorage.getItem(key), SOLVER_SETTINGS_KEY)).toBe(raw)
})

test('profile import affects only the active build and the full library round-trips', async ({ page }) => {
  await page.goto('/')
  await openPanel(page, '.reward-settings')
  await rename(page, 'Mapping')
  await page.getByLabel(weightLabel).fill('18')
  await page.getByRole('button', { name: 'New profile', exact: true }).click()
  await rename(page, 'Bossing')
  const profile = { ...newSolverSettings(), definitions: [{ id: crypto.randomUUID(), label: 'My tooltip', kind: 'combo', threshold: 2, note: '' }] }
  await page.getByLabel('Import solver profile').setInputFiles({ name: 'profile.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(profile)) })
  await expect(page.getByRole('status').filter({ hasText: 'Profile imported.' })).toBeVisible()
  await expect(page.getByLabel('Profile name', { exact: true })).toHaveValue('Bossing')
  await expect(page.getByRole('heading', { name: 'Personal reward templates (1)' })).toBeVisible()
  await page.getByRole('combobox', { name: 'Active profile', exact: true }).selectOption({ label: 'Mapping' })
  await expect(page.getByLabel(weightLabel)).toHaveValue('18')
  await expect(page.getByRole('heading', { name: /Personal reward templates/ })).toHaveCount(0)
  const exported = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export library', exact: true }).click()
  const download = await exported
  expect(download.suggestedFilename()).toBe('fate-solver-library.json')
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Delete profile', exact: true }).click()
  await expect(page.getByLabel('Profile name', { exact: true })).toHaveValue('Bossing')
  await expect(page.getByRole('button', { name: 'Delete profile', exact: true })).toBeDisabled()
  page.once('dialog', dialog => dialog.accept())
  await page.getByLabel('Import solver library').setInputFiles((await download.path())!)
  await expect(page.getByRole('status').filter({ hasText: 'Profile library restored.' })).toBeVisible()
  await expect(page.getByLabel('Profile name', { exact: true })).toHaveValue('Mapping')
  await expect(page.getByLabel(weightLabel)).toHaveValue('18')
  await page.getByRole('combobox', { name: 'Active profile', exact: true }).selectOption({ label: 'Bossing' })
  await expect(page.getByRole('heading', { name: 'Personal reward templates (1)' })).toBeVisible()
})

test('invalid names, unapplied filters and cancelled deletion preserve profiles', async ({ page }) => {
  await page.goto('/')
  await openPanel(page, '.reward-settings')
  await page.getByRole('button', { name: 'Duplicate profile', exact: true }).click()
  await page.getByLabel('Profile name', { exact: true }).fill('MY BUILD')
  await page.getByRole('button', { name: 'Save name', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'already exists' })).toBeVisible()
  await page.getByLabel('Profile name', { exact: true }).fill('My build copy')
  await page.getByLabel('Avoid modifiers containing').fill('unsaved filter')
  page.once('dialog', dialog => dialog.dismiss())
  await page.getByRole('combobox', { name: 'Active profile', exact: true }).selectOption({ label: 'My build' })
  await expect(page.getByLabel('Profile name', { exact: true })).toHaveValue('My build copy')
  await expect(page.getByLabel('Avoid modifiers containing')).toHaveValue('unsaved filter')
  await page.getByRole('button', { name: 'Apply modifier filters', exact: true }).click()
  page.once('dialog', dialog => dialog.dismiss())
  await page.getByRole('button', { name: 'Delete profile', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Active profile', exact: true }).locator('option')).toHaveCount(2)
})

test('unreadable library offers raw recovery and requires explicit reset', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(key => localStorage.setItem(key, '{broken library'), SOLVER_LIBRARY_KEY)
  await page.reload()
  await openPanel(page, '.reward-settings')
  await expect(page.getByRole('alert').filter({ hasText: 'could not be read' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Active profile', exact: true })).toBeDisabled()
  const recovery = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export stored copy', exact: true }).click()
  const { readFile } = await import('node:fs/promises')
  expect(await readFile((await (await recovery).path())!, 'utf8')).toBe('{broken library')
  page.once('dialog', dialog => dialog.dismiss())
  await page.getByRole('button', { name: 'Reset profile library', exact: true }).click()
  expect(await page.evaluate(key => localStorage.getItem(key), SOLVER_LIBRARY_KEY)).toBe('{broken library')
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Reset profile library', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Active profile', exact: true })).toBeEnabled()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('a delayed profile import cannot overwrite a different active build', async ({ page }) => {
  await page.goto('/')
  await openPanel(page, '.reward-settings')
  await page.getByRole('button', { name: 'Duplicate profile', exact: true }).click()
  await page.evaluate(() => {
    const original = File.prototype.text
    File.prototype.text = async function () {
      const text = await original.call(this)
      await new Promise<void>(resolve => Object.defineProperty(window, 'finishProfileRead', { value: resolve, configurable: true }))
      return text
    }
  })
  await page.getByLabel('Import solver profile').setInputFiles({ name: 'delayed.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...newSolverSettings(), profile: { goals: [], avoidModifiers: [] } })) })
  await page.waitForFunction(() => 'finishProfileRead' in window)
  await page.getByRole('combobox', { name: 'Active profile', exact: true }).selectOption({ label: 'My build' })
  const before = await page.evaluate(key => localStorage.getItem(key), SOLVER_LIBRARY_KEY)
  await page.evaluate(() => (window as unknown as { finishProfileRead: () => void }).finishProfileRead())
  await expect(page.getByLabel(weightLabel)).toHaveValue('3')
  expect(await page.evaluate(key => localStorage.getItem(key), SOLVER_LIBRARY_KEY)).toBe(before)
})

test('a failed save preserves all in-memory profiles for export', async ({ page }) => {
  await page.addInitScript(key => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException('Full', 'QuotaExceededError')
      return original.call(this, name, value)
    }
  }, SOLVER_LIBRARY_KEY)
  await page.goto('/')
  await openPanel(page, '.reward-settings')
  await page.getByLabel(weightLabel).fill('27')
  await page.getByRole('button', { name: 'Duplicate profile', exact: true }).click()
  await page.getByLabel(weightLabel).fill('9')
  await expect(page.getByRole('alert').filter({ hasText: 'could not be saved' })).toBeVisible()
  const saved = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export library', exact: true }).click()
  const { readFile } = await import('node:fs/promises')
  const exported = JSON.parse(await readFile((await (await saved).path())!, 'utf8'))
  expect(exported.profiles.map((row: { settings: ReturnType<typeof newSolverSettings> }) => row.settings.profile.goals.find(item => item.label === goal && item.kind === 'regular')?.weight)).toEqual([27, 9])
  expect(await page.evaluate(key => localStorage.getItem(key), SOLVER_LIBRARY_KEY)).toBeNull()
  page.once('dialog', async dialog => { expect(dialog.message()).toContain('Discard all unsaved profile changes'); await dialog.dismiss() })
  await page.getByRole('button', { name: 'Reload saved profile', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Active profile' }).locator('option')).toHaveCount(2)
  await expect(page.getByLabel(weightLabel)).toHaveValue('9')
})

test('a delayed library import cannot replace profiles edited during the read', async ({ page }) => {
  await page.goto('/')
  await openPanel(page, '.reward-settings')
  await rename(page, 'Before import')
  const originalLibrary = await page.evaluate(key => localStorage.getItem(key)!, SOLVER_LIBRARY_KEY)
  await page.evaluate(() => {
    const original = File.prototype.text
    File.prototype.text = async function () {
      const text = await original.call(this)
      await new Promise<void>(resolve => Object.defineProperty(window, 'finishLibraryRead', { value: resolve, configurable: true }))
      return text
    }
  })
  await page.getByLabel('Import solver library').setInputFiles({ name: 'delayed-library.json', mimeType: 'application/json', buffer: Buffer.from(originalLibrary) })
  await page.waitForFunction(() => 'finishLibraryRead' in window)
  await rename(page, 'Newer name')
  await page.evaluate(() => (window as unknown as { finishLibraryRead: () => void }).finishLibraryRead())
  await expect(page.getByRole('alert').filter({ hasText: 'changed while reading' })).toBeVisible()
  await expect(page.getByLabel('Profile name', { exact: true })).toHaveValue('Newer name')
})

test('a restored library stays exportable if saving over a corrupt copy fails', async ({ page }) => {
  await page.goto('/')
  await openPanel(page, '.reward-settings')
  await rename(page, 'Recovered build')
  const backup = await page.evaluate(key => localStorage.getItem(key)!, SOLVER_LIBRARY_KEY)
  await page.evaluate(key => localStorage.setItem(key, '{broken'), SOLVER_LIBRARY_KEY)
  await page.reload()
  await page.evaluate(key => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (name, value) { if (name === key) throw new Error('Quota'); return original.call(this, name, value) }
  }, SOLVER_LIBRARY_KEY)
  await openPanel(page, '.reward-settings')
  page.once('dialog', dialog => dialog.accept())
  await page.getByLabel('Import solver library').setInputFiles({ name: 'healthy.json', mimeType: 'application/json', buffer: Buffer.from(backup) })
  await expect(page.getByLabel('Profile name', { exact: true })).toHaveValue('Recovered build')
  await expect(page.getByRole('combobox', { name: 'Active profile' })).toBeEnabled()
  await expect(page.getByRole('alert').filter({ hasText: 'could not be saved' })).toBeVisible()
  const saved = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export library', exact: true }).click()
  const { readFile } = await import('node:fs/promises')
  expect(JSON.parse(await readFile((await (await saved).path())!, 'utf8')).profiles[0].name).toBe('Recovered build')
  await expect(page.getByRole('button', { name: 'Export stored copy' })).toBeVisible()
  expect(await page.evaluate(key => localStorage.getItem(key), SOLVER_LIBRARY_KEY)).toBe('{broken')
})

test('library import checks the latest unsaved name and modifier draft', async ({ page }) => {
  await page.goto('/')
  await openPanel(page, '.reward-settings')
  await rename(page, 'Saved build')
  const backup = await page.evaluate(key => localStorage.getItem(key)!, SOLVER_LIBRARY_KEY)
  await page.evaluate(() => {
    const original = File.prototype.text
    File.prototype.text = async function () {
      const text = await original.call(this)
      await new Promise<void>(resolve => Object.defineProperty(window, 'finishDraftRead', { value: resolve, configurable: true }))
      return text
    }
  })
  await page.getByLabel('Import solver library').setInputFiles({ name: 'delayed.json', mimeType: 'application/json', buffer: Buffer.from(backup) })
  await page.waitForFunction(() => 'finishDraftRead' in window)
  await page.getByLabel('Profile name', { exact: true }).fill('Unsaved name')
  await page.getByLabel('Avoid modifiers containing').fill('unsaved filter')
  const prompts: string[] = []
  page.on('dialog', async dialog => {
    prompts.push(dialog.message())
    if (dialog.message().includes('unsaved profile name')) await dialog.accept()
    else await dialog.dismiss()
  })
  await page.evaluate(() => (window as unknown as { finishDraftRead: () => void }).finishDraftRead())
  await expect.poll(() => prompts.length).toBe(2)
  expect(prompts[1]).toContain('unapplied modifier filters')
  await expect(page.getByLabel('Profile name', { exact: true })).toHaveValue('Unsaved name')
  await expect(page.getByLabel('Avoid modifiers containing')).toHaveValue('unsaved filter')
  expect(await page.evaluate(key => localStorage.getItem(key), SOLVER_LIBRARY_KEY)).toBe(backup)
})
