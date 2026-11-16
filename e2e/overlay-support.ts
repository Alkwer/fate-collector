import { expect, type Page } from '@playwright/test'
import type { OverlayState } from '../shared/overlay'
import { closePanels } from './ui'

export async function write(page: Page, name: string, value: unknown, bridge = true) {
  await page.evaluate(async ({ name, value, bridge }) => {
    let folder = await (await navigator.storage.getDirectory()).getDirectoryHandle('captures', { create: true })
    if (bridge) folder = await folder.getDirectoryHandle('.overlay', { create: true })
    const writer = await (await folder.getFileHandle(name, { create: true })).createWritable()
    await writer.write(JSON.stringify(value)); await writer.close()
  }, { name, value, bridge })
}
export async function state(page: Page): Promise<OverlayState | null> {
  return page.evaluate(async () => {
    try {
      const captures = await (await navigator.storage.getDirectory()).getDirectoryHandle('captures')
      const folder = await captures.getDirectoryHandle('.overlay')
      return JSON.parse(await (await (await folder.getFileHandle('state.json')).getFile()).text())
    } catch { return null }
  })
}
export async function action(page: Page, id: string, overrides: Record<string, unknown> = {}) {
  const latest = (await state(page))!
  expect(latest.actions.some(item => item.id === id)).toBe(true)
  const commandId = crypto.randomUUID()
  await write(page, 'command.json', { protocol: 1, id: commandId, clientId: latest.clientId, revision: latest.revision, captureId: latest.captureId, createdAt: Date.now(), action: id, ...overrides })
  await expect.poll(async () => (await state(page))?.acknowledgedCommandId).toBe(commandId)
  return commandId
}
export async function setup(page: Page, url = '/') {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: async () => {
      const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle('captures', { create: true })
      await directory.getDirectoryHandle('.overlay', { create: true })
      return directory
    } })
  })
  await page.goto(url)
  await page.getByRole('button', { name: 'More actions', exact: true }).click()
  await page.getByRole('button', { name: 'In-game overlay', exact: true }).click()
  await page.getByRole('button', { name: 'Connect overlay folder' }).click()
  await expect(page.getByText('Overlay connected.', { exact: false })).toBeVisible()
  await closePanels(page)
}
export async function capture(page: Page) {
  const bundle = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 500
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#172b34'; ctx.fillRect(0, 0, 800, 500)
    ctx.fillStyle = '#edf5f5'; ctx.font = '24px sans-serif'; ctx.fillText('Alchemist', 30, 70)
    return { kind: 'fate-collector.capture', schemaVersion: 1, captureId: crypto.randomUUID(), capturedAt: new Date().toISOString(), source: 'windows-helper', helperVersion: '0.6.0', context: { captureMode: 'fixture' },
      image: { width: 800, height: 500, mimeType: 'image/png', dataBase64: canvas.toDataURL('image/png').split(',')[1] },
      ocr: { status: 'ok', text: 'Fates\nAlchemist\nCONFIRM', language: 'en-US', lines: [
        { text: 'Fates', x: 350, y: 5, width: 70, height: 20 }, { text: 'Alchemist', x: 30, y: 45, width: 140, height: 30 }, { text: 'CONFIRM', x: 350, y: 400, width: 120, height: 20 },
      ] } }
  })
  await write(page, 'capture.json', { protocol: 1, captureId: bundle.captureId, phase: 'capturing', updatedAt: Date.now() })
  await expect.poll(async () => (await state(page))?.title).toContain('Analyzing')
  await write(page, `fate-${bundle.captureId}.json`, bundle, false)
  await write(page, 'capture.json', { protocol: 1, captureId: bundle.captureId, phase: 'saved', updatedAt: Date.now() })
  await expect.poll(async () => (await state(page))?.actions.some(item => item.id === 'use-offer')).toBe(true)
  return bundle.captureId
}

