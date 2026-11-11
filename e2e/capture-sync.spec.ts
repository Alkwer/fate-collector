import { openDisclosure } from './ui'
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
    context.fillText('Fates', 350, 25); context.fillText('CONFIRM', 350, 420)
    return { kind: 'fate-collector.capture', schemaVersion: 1, captureId: crypto.randomUUID(), capturedAt: new Date().toISOString(), source: 'windows-helper', helperVersion: '0.1.0', context: { captureMode: 'fixture' },
      image: { width: 800, height: 500, mimeType: 'image/png', dataBase64: canvas.toDataURL('image/png').split(',')[1] },
      ocr: { status: 'ok', text: 'Fates\nAlchemist\nCONFIRM', language: 'en-US', lines: [
        { text: 'Fates', x: 350, y: 5, width: 70, height: 20 },
        { text: 'Alchemist', x: 30, y: 45, width: 140, height: 30 },
        { text: 'CONFIRM', x: 350, y: 400, width: 120, height: 20 },
      ] } }
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

test('a stale automatic editor cannot recreate an offer deleted in another tab', async ({ page, context }) => {
  await setup(page)
  const capture = await bundle(page)
  await writeFile(page, `fate-${capture.captureId}.json`, JSON.stringify(capture))
  await openDisclosure(page, '.map-capture-connection')
  await page.getByRole('button', { name: 'Connect folder', exact: true }).click()
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible()
  await page.getByText('Edit details', { exact: true }).click()
  const other = await context.newPage()
  await setup(other)
  other.on('dialog', dialog => dialog.accept())
  await other.getByRole('button', { name: /Saved offers/ }).click()
  await other.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(other.getByRole('heading', { name: 'No offers here yet.' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Notes', exact: true }).fill('Preserve my stale draft')
  await expect(page.getByRole('alert')).toContainText('deleted in another tab')
  await expect(page.locator('.auto-save-state')).toHaveText('Save conflict')
  await expect(page.getByRole('textbox', { name: 'Notes', exact: true })).toHaveValue('Preserve my stale draft')
  await other.reload()
  await other.getByRole('button', { name: /Saved offers/ }).click()
  await expect(other.getByRole('heading', { name: 'No offers here yet.' })).toBeVisible()
})

test('metadata restored during the same folder connection recovers its screenshot and preserves corrections', async ({ page }) => {
  await setup(page)
  const capture = await bundle(page)
  await writeFile(page, `fate-${capture.captureId}.json`, JSON.stringify(capture))
  await openDisclosure(page, '.map-capture-connection')
  await page.getByRole('button', { name: 'Connect folder', exact: true }).click()
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible()
  const offer = await page.evaluate(id => new Promise<Record<string, unknown>>((resolve, reject) => {
    const open = indexedDB.open('fate-collector')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result, request = db.transaction('offers').objectStore('offers').get(id)
      request.onsuccess = () => { resolve(request.result.offer); db.close() }
    }
  }), capture.captureId)
  page.on('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: /Saved offers/ }).click()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Local offer deleted.')
  await page.getByRole('button', { name: 'Current map', exact: true }).click()
  await page.getByLabel('Import capture file').setInputFiles({ name: 'restored.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...offer, notes: 'Restored correction' })) })
  await page.getByText('Edit details', { exact: true }).click()
  await expect(page.getByRole('img', { name: 'Captured Fate offer', exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Notes', exact: true })).toHaveValue('Restored correction')
  await page.getByRole('button', { name: /Saved offers/ }).click()
  await expect(page.getByText('Revision 1', { exact: true })).toBeVisible()
})

test('modifier validation identifies the invalid line and resumes autosave after correction', async ({ page }) => {
  await setup(page)
  const capture = await bundle(page)
  await writeFile(page, `fate-${capture.captureId}.json`, JSON.stringify(capture))
  await openDisclosure(page, '.map-capture-connection')
  await page.getByRole('button', { name: 'Connect folder', exact: true }).click()
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible()
  await page.getByText('Edit details', { exact: true }).click()
  await page.locator('.card-details > summary').click()
  await page.getByRole('textbox', { name: 'Modifiers', exact: true }).fill('x'.repeat(1001))
  await expect(page.getByRole('textbox', { name: 'Modifiers', exact: true })).toHaveAccessibleDescription(/line 1 exceeds/)
  await expect(page.getByRole('textbox', { name: 'Modifiers', exact: true })).toHaveAttribute('aria-invalid', 'true')
  await page.getByRole('textbox', { name: 'Modifiers', exact: true }).fill(Array(41).fill('Short line').join('\n'))
  await expect(page.getByRole('textbox', { name: 'Modifiers', exact: true })).toHaveAccessibleDescription(/at most 40/)
  await page.getByRole('textbox', { name: 'Modifiers', exact: true }).fill('Corrected modifier')
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Modifiers', exact: true })).toHaveAttribute('aria-invalid', 'false')
  await page.reload()
  await page.getByRole('button', { name: /Saved offers/ }).click()
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await page.getByText('Edit details', { exact: true }).click()
  await page.locator('.card-details > summary').click()
  await expect(page.getByRole('textbox', { name: 'Modifiers', exact: true })).toHaveValue('Corrected modifier')
})

test('folder capture auto-saves, corrections auto-save, reconnect deduplicates, deletion persists and disconnect stops intake', async ({ page }) => {
  const errors: string[] = [], uploads: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().endsWith('/api/observations')) uploads.push(request.url()) })
  await setup(page)
  await openDisclosure(page, '.map-capture-connection')
  await expect(page.getByRole('region', { name: 'Local capture review', exact: true })).toContainText('Optional:')
  await expect(page.getByRole('region', { name: 'Local capture review', exact: true })).toContainText('Cloud upload is configured in the helper and can run with this page closed.')
  const first = await bundle(page)
  await writeFile(page, `fate-${first.captureId}.json`, JSON.stringify(first))
  await openDisclosure(page, '.map-capture-connection')
  await page.getByRole('button', { name: 'Connect folder', exact: true }).click()
  await expect(page.locator('.map-capture-connection > summary')).toContainText('Local review connected')
  await expect(page.getByRole('heading', { name: 'Alchemist', exact: true })).toBeVisible()
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible()
  await expect(page.locator('.action-band')).toContainText('Not reviewed yet.')
  await expect(page.getByRole('button', { name: 'Confirm and save', exact: true })).toHaveCount(0)
  // The optional solver switch is visible; capture intake still needs no form fields.
  await expect(page.getByLabel('Compare multiple rewards', { exact: true })).not.toBeChecked()
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
  await expect(page.locator('.map-capture-connection > summary')).toContainText('Local review connected')
  await page.getByRole('button', { name: /Saved offers/ }).click()
  await expect(page.getByRole('cell', { name: /Alchemist corrected/ })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'unverified Needs review', exact: true })).toHaveCount(2)
  const corrected = page.getByRole('row').filter({ hasText: 'Alchemist corrected' })
  page.on('dialog', dialog => dialog.accept())
  await corrected.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.getByRole('button', { name: /^Saved offers\s*1$/ })).toBeVisible()
  await page.reload()
  await expect(page.locator('.map-capture-connection > summary')).toContainText('Local review connected')
  await page.waitForTimeout(2400) // Observe a poll after reload: deleted captures must stay deleted.
  await expect(page.getByRole('button', { name: /^Saved offers\s*1$/ })).toBeVisible()
  await openDisclosure(page, '.map-capture-connection')
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click()
  const third = await bundle(page)
  await writeFile(page, `fate-${third.captureId}.json`, JSON.stringify(third))
  await page.waitForTimeout(2400)
  await expect(page.getByRole('button', { name: /^Saved offers\s*1$/ })).toBeVisible()
  await page.reload()
  await openDisclosure(page, '.map-capture-connection')
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
  await openDisclosure(page, '.map-capture-connection')
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
  await openDisclosure(page, '.map-capture-connection')
  await page.getByRole('button', { name: 'Connect folder', exact: true }).click()
  await expect(page.locator('.map-capture-connection > summary')).toContainText('Local review connected')
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

test('an unread offered row saves its evidence without promoting a collected card', async ({ page }) => {
  await setup(page)
  const capture = await bundle(page)
  capture.ocr.lines = capture.ocr.lines.map(entry => entry.text === 'Alchemist' ? { ...entry, text: 'Unrecognized header' } : entry)
  capture.ocr.lines.push({ text: 'Torchbearer', x: 300, y: 450, width: 140, height: 30 })
  capture.ocr.text = capture.ocr.lines.map(entry => entry.text).join('\n')
  await writeFile(page, `fate-${capture.captureId}.json`, JSON.stringify(capture))
  await openDisclosure(page, '.map-capture-connection')
  await page.getByRole('button', { name: 'Connect folder', exact: true }).click()
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Your capture is saved.', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Torchbearer', exact: true })).toHaveCount(0)
  await page.reload()
  await page.getByRole('button', { name: /Saved offers/ }).click()
  await expect(page.getByRole('cell', { name: 'unverified Needs review', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(page.getByRole('img', { name: 'Captured Fate offer', exact: true })).toBeVisible()
  await page.getByText('Edit details', { exact: true }).click()
  await page.getByText('Original OCR text', { exact: true }).click()
  await expect(page.locator('.ocr-text')).toHaveText(capture.ocr.text)
})

test('an unavailable folder can be disconnected and replaced without clearing browser data', async ({ page }) => {
  await setup(page)
  await openDisclosure(page, '.map-capture-connection')
  await page.getByRole('button', { name: 'Connect folder', exact: true }).click()
  await expect(page.locator('.map-capture-connection > summary')).toContainText('Local review connected')
  await page.evaluate(() => {
    Reflect.set(window, 'originalFolderValues', FileSystemDirectoryHandle.prototype.values)
    Reflect.set(FileSystemDirectoryHandle.prototype, 'values', async function* () { throw new DOMException('The folder was removed.', 'NotFoundError') })
  })
  await expect(page.getByText('Local auto-save is paused', { exact: true })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('folder was removed')
  await openDisclosure(page, '.map-capture-connection')
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Connect folder', exact: true })).toBeVisible()
  await page.evaluate(() => { Reflect.set(FileSystemDirectoryHandle.prototype, 'values', Reflect.get(window, 'originalFolderValues')) })
  await openDisclosure(page, '.map-capture-connection')
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
  await openDisclosure(page, '.map-capture-connection')
  await page.getByRole('button', { name: 'Connect folder', exact: true }).click()
  await expect(page.locator('.map-capture-connection > summary')).toContainText('Local review connected')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.evaluate(() => { Reflect.set(FileSystemDirectoryHandle.prototype, 'queryPermission', async () => 'denied') })
  await expect(page.getByRole('button', { name: 'Resume local review', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await openDisclosure(page, '.map-capture-connection')
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Connect folder', exact: true })).toBeVisible()
})

test('edits typed during an in-flight auto-save use its committed revision without losing text', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await setup(page)
  const capture = await bundle(page)
  await writeFile(page, `fate-${capture.captureId}.json`, JSON.stringify(capture))
  await openDisclosure(page, '.map-capture-connection')
  await page.getByRole('button', { name: 'Connect folder', exact: true }).click()
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible()
  await page.getByText('Edit details', { exact: true }).click()
  // Hold a real IndexedDB writer open, so the first auto-save waits while the
  // user keeps typing. Releasing it exercises the delayed commit acknowledgement.
  await page.evaluate(id => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('fate-collector')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result
      const transaction = database.transaction('offers', 'readwrite')
      transaction.oncomplete = () => database.close()
      let released = false
      Reflect.set(window, 'releaseTestWriter', () => { released = true })
      const keepAlive = () => {
        const read = transaction.objectStore('offers').get(id)
        read.onsuccess = () => { if (!released) keepAlive() }
      }
      keepAlive(); resolve()
    }
  }), capture.captureId)
  await page.getByRole('textbox', { name: 'Notes', exact: true }).fill('First correction')
  await expect(page.locator('.auto-save-state')).toHaveText('Saving changes…')
  await page.getByLabel('Area', { exact: true }).fill('Typed while saving')
  await page.evaluate(() => Reflect.get(window, 'releaseTestWriter')())
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.reload()
  await page.getByRole('button', { name: /Saved offers/ }).click()
  await expect(page.getByText('Revision 3', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await page.getByText('Edit details', { exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Notes', exact: true })).toHaveValue('First correction')
  await expect(page.getByLabel('Area', { exact: true })).toHaveValue('Typed while saving')
  expect(errors).toEqual([])
})

test('automatic corrections from a stale tab stay pending and preserve the newer stored revision', async ({ page, context }) => {
  await setup(page)
  const capture = await bundle(page)
  await writeFile(page, `fate-${capture.captureId}.json`, JSON.stringify(capture))
  await openDisclosure(page, '.map-capture-connection')
  await page.getByRole('button', { name: 'Connect folder', exact: true }).click()
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible()
  await page.getByText('Edit details', { exact: true }).click()
  // A clean tab now follows broadcasts. An invalid field keeps this draft
  // pending while the sibling commits; fixing it must not rebase its revision.
  await page.getByLabel('Area level', { exact: true }).fill('101')
  await page.getByLabel('Area', { exact: true }).fill('Stale auto-save')
  const other = await context.newPage()
  await setup(other)
  await expect(other.locator('.map-capture-connection > summary')).toContainText('Local review connected')
  await other.getByRole('button', { name: /Saved offers/ }).click()
  await other.getByRole('button', { name: 'Open', exact: true }).click()
  await other.getByText('Edit details', { exact: true }).click()
  await other.getByRole('textbox', { name: 'Notes', exact: true }).fill('Newer auto-saved correction')
  await expect(other.getByText('Saved locally', { exact: true })).toBeVisible()
  await page.getByLabel('Area level', { exact: true }).fill('')
  await expect(page.locator('div.notice[role="alert"]')).toContainText('changed in another tab')
  await expect(page.locator('.auto-save-state')).toHaveText('Save conflict')
  await expect(page.getByRole('button', { name: 'Retry save', exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Area', { exact: true })).toHaveValue('Stale auto-save')
  await other.reload()
  await other.getByRole('button', { name: /Saved offers/ }).click()
  await expect(other.getByText('Revision 2', { exact: true })).toBeVisible()
  await other.getByRole('button', { name: 'Open', exact: true }).click()
  await other.getByText('Edit details', { exact: true }).click()
  await expect(other.getByRole('textbox', { name: 'Notes', exact: true })).toHaveValue('Newer auto-saved correction')
  await expect(other.getByLabel('Area', { exact: true })).toHaveValue('')
})

for (const width of [1440, 390]) {
  test(`a failed automatic save can retry unchanged corrections at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const errors: string[] = [], uploads: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('request', request => { if (request.url().endsWith('/api/observations')) uploads.push(request.url()) })
    await setup(page)
    const capture = await bundle(page)
    await writeFile(page, `fate-${capture.captureId}.json`, JSON.stringify(capture))
    await openDisclosure(page, '.map-capture-connection')
    await page.getByRole('button', { name: 'Connect folder', exact: true }).click()
    await expect(page.getByText('Saved locally', { exact: true })).toBeVisible()
    await page.getByText('Edit details', { exact: true }).click()
    // Abort real write transactions twice: the initial save and the first retry.
    // Reads still work, and no offer/evidence write in these transactions commits.
    await page.evaluate(() => {
      const original = IDBObjectStore.prototype.put
      let attempts = 0
      Reflect.set(window, 'testSaveAttempts', () => attempts)
      IDBObjectStore.prototype.put = function (...args) {
        if (this.name === 'offers') {
          attempts++
          if (attempts <= 2) { const request = original.apply(this, args); this.transaction.abort(); return request }
          IDBObjectStore.prototype.put = original
        }
        return original.apply(this, args)
      }
    })
    await page.getByRole('textbox', { name: 'Notes', exact: true }).fill('Keep this exact correction')
    const retry = page.getByRole('button', { name: 'Retry save', exact: true })
    await expect(retry).toBeVisible()
    await expect(page.locator('.auto-save-state')).toHaveText('Save failed')
    await page.getByRole('button', { name: 'Dismiss message' }).click()
    await expect(retry).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await retry.click()
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(retry).toBeVisible()
    expect(await page.evaluate(() => Reflect.get(window, 'testSaveAttempts')())).toBe(2)
    await retry.click()
    await expect(page.getByText('Saved locally', { exact: true })).toBeVisible()
    await expect(retry).toHaveCount(0)
    await expect(page.getByRole('alert')).toHaveCount(0)
    await page.reload()
    await page.getByRole('button', { name: /Saved offers/ }).click()
    await expect(page.getByText('Revision 2', { exact: true })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'unverified Needs review', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Open', exact: true }).click()
    await page.getByText('Edit details', { exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Notes', exact: true })).toHaveValue('Keep this exact correction')
    expect(errors).toEqual([]); expect(uploads).toEqual([])
  })
}
