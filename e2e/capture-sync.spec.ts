import { expect, test, type Page } from '@playwright/test'

// The picker is substituted with a native OPFS directory. Enumeration, file I/O,
// permission methods and IndexedDB handle persistence use Chromium's actual APIs.
// The operating system's external-folder permission dialog is not automated here.
async function setup(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: async () => (await navigator.storage.getDirectory()).getDirectoryHandle('captures', { create: true }) })
  })
  await page.goto('/')
}
async function bundle(page: Page) {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 500
    const context = canvas.getContext('2d')!
    context.fillStyle = '#191c19'; context.fillRect(0, 0, 800, 500)
    context.fillStyle = '#eee9dc'; context.font = '24px sans-serif'; context.fillText('Alchemist', 30, 70)
    return { kind: 'fate-collector.capture', schemaVersion: 1, captureId: crypto.randomUUID(), capturedAt: new Date().toISOString(), source: 'windows-helper', helperVersion: '0.1.0', context: { captureMode: 'fixture' },
      image: { width: 800, height: 500, mimeType: 'image/png', dataBase64: canvas.toDataURL('image/png').split(',')[1] },
      ocr: { status: 'ok', text: 'Alchemist', language: 'en-US', lines: [{ text: 'Alchemist', x: 30, y: 45, width: 140, height: 30 }] } }
  })
}
async function writeFile(page: Page, name: string, text: string) {
  await page.evaluate(async ({ name, text }) => {
    const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle('captures', { create: true })
    const file = await directory.getFileHandle(name, { create: true })
    const writable = await file.createWritable()
    await writable.write(text); await writable.close()
  }, { name, text })
}

test('folder capture auto-saves, corrections auto-save, reconnect deduplicates, deletion persists and disconnect stops intake', async ({ page }) => {
  const errors: string[] = [], uploads: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().endsWith('/api/observations')) uploads.push(request.url()) })
  await setup(page)
  await expect(page.getByRole('region', { name: 'Local capture review', exact: true })).toContainText('Optional:')
  await expect(page.getByRole('region', { name: 'Local capture review', exact: true })).toContainText('Cloud upload is configured in the helper and can run with this page closed.')
  const first = await bundle(page)
  await writeFile(page, `fate-${first.captureId}.json`, JSON.stringify(first))
  await page.getByRole('button', { name: 'Connect folder', exact: true }).click()
  await expect(page.getByText('Local review connected', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Alchemist', exact: true })).toBeVisible()
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible()
  await expect(page.locator('.action-band')).toContainText('Not reviewed yet.')
  await expect(page.getByRole('button', { name: 'Confirm and save', exact: true })).toHaveCount(0)
  await expect(page.locator('input:visible, textarea:visible, select:visible')).toHaveCount(0)

  await page.getByText('Edit details', { exact: true }).click()
  await page.getByLabel('Fate name', { exact: true }).fill('Alchemist corrected')
  await expect(page.locator('.action-band')).toContainText('Your corrections have not been saved yet.')
  await expect(page.locator('.action-band')).not.toContainText('Capture saved.')
  const second = await bundle(page)
  await writeFile(page, `fate-${second.captureId}.json`, JSON.stringify(second))
  await expect(page.getByRole('button', { name: /^Saved offers\s*2$/ })).toBeVisible()
  await expect(page.getByLabel('Fate name', { exact: true })).toHaveValue('Alchemist corrected')
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText('Local review connected', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /Saved offers/ }).click()
  await expect(page.getByRole('cell', { name: /Alchemist corrected/ })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'unverified Needs review', exact: true })).toHaveCount(2)
  const corrected = page.getByRole('row').filter({ hasText: 'Alchemist corrected' })
  page.on('dialog', dialog => dialog.accept())
  await corrected.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.getByRole('button', { name: /^Saved offers\s*1$/ })).toBeVisible()
  await page.reload()
  await expect(page.getByText('Local review connected', { exact: true })).toBeVisible()
  await page.waitForTimeout(2400) // Observe a poll after reload: deleted captures must stay deleted.
  await expect(page.getByRole('button', { name: /^Saved offers\s*1$/ })).toBeVisible()
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click()
  const third = await bundle(page)
  await writeFile(page, `fate-${third.captureId}.json`, JSON.stringify(third))
  await page.waitForTimeout(2400)
  await expect(page.getByRole('button', { name: /^Saved offers\s*1$/ })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Connect folder', exact: true })).toBeVisible()
  expect(errors).toEqual([]); expect(uploads).toEqual([])
})

test('pending and malformed files cannot block unread captures; a repaired capture is retried', async ({ page }) => {
  await setup(page)
  const pending = await bundle(page), unread = await bundle(page), broken = await bundle(page)
  unread.ocr.status = 'unavailable'; unread.ocr.text = ''; unread.ocr.lines = []
  await writeFile(page, `fate-${pending.captureId}.json.part`, JSON.stringify(pending))
  await writeFile(page, `fate-${broken.captureId}.json`, '{broken')
  await writeFile(page, `fate-${unread.captureId}.json`, JSON.stringify(unread))
  await page.getByRole('button', { name: 'Connect folder', exact: true }).click()
  await expect(page.getByRole('button', { name: /^Saved offers\s*1$/ })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('could not be read')
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible()
  await writeFile(page, `fate-${broken.captureId}.json`, JSON.stringify(broken))
  await expect(page.getByRole('button', { name: /^Saved offers\s*2$/ })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.getByRole('button', { name: /Saved offers/ }).click()
  await expect(page.getByRole('cell', { name: 'unverified Needs review', exact: true })).toHaveCount(2)
})

test('revoked folder permission pauses intake and can be resumed', async ({ page }) => {
  await setup(page)
  await page.getByRole('button', { name: 'Connect folder', exact: true }).click()
  await expect(page.getByText('Local review connected', { exact: true })).toBeVisible()
  await page.evaluate(() => {
    Reflect.set(window, 'originalFolderQuery', Reflect.get(FileSystemDirectoryHandle.prototype, 'queryPermission'))
    Reflect.set(FileSystemDirectoryHandle.prototype, 'queryPermission', async () => 'denied')
  })
  await expect(page.getByRole('button', { name: 'Resume local review' })).toBeVisible()
  const capture = await bundle(page)
  await writeFile(page, `fate-${capture.captureId}.json`, JSON.stringify(capture))
  await page.evaluate(() => { Reflect.set(FileSystemDirectoryHandle.prototype, 'queryPermission', Reflect.get(window, 'originalFolderQuery')) })
  await page.getByRole('button', { name: 'Resume local review' }).click()
  await expect(page.getByRole('heading', { name: 'Alchemist', exact: true })).toBeVisible()
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible()
})

test('an unavailable folder can be disconnected and replaced without clearing browser data', async ({ page }) => {
  await setup(page)
  await page.getByRole('button', { name: 'Connect folder', exact: true }).click()
  await expect(page.getByText('Local review connected', { exact: true })).toBeVisible()
  await page.evaluate(() => {
    Reflect.set(window, 'originalFolderValues', FileSystemDirectoryHandle.prototype.values)
    Reflect.set(FileSystemDirectoryHandle.prototype, 'values', async function* () { throw new DOMException('The folder was removed.', 'NotFoundError') })
  })
  await expect(page.getByText('Local auto-save is paused', { exact: true })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('folder was removed')
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Connect folder', exact: true })).toBeVisible()
  await page.evaluate(() => { Reflect.set(FileSystemDirectoryHandle.prototype, 'values', Reflect.get(window, 'originalFolderValues')) })
  await page.getByRole('button', { name: 'Connect folder', exact: true }).click()
  const capture = await bundle(page)
  await writeFile(page, `fate-${capture.captureId}.json`, JSON.stringify(capture))
  await expect(page.getByRole('heading', { name: 'Alchemist', exact: true })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('long capture-folder names and paused controls fit a narrow phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 780 })
  await setup(page)
  await page.evaluate(() => {
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: async () => (await navigator.storage.getDirectory()).getDirectoryHandle('captures-' + 'x'.repeat(160), { create: true }) })
  })
  await page.getByRole('button', { name: 'Connect folder', exact: true }).click()
  await expect(page.getByText('Local review connected', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.evaluate(() => { Reflect.set(FileSystemDirectoryHandle.prototype, 'queryPermission', async () => 'denied') })
  await expect(page.getByRole('button', { name: 'Resume local review', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Connect folder', exact: true })).toBeVisible()
})
