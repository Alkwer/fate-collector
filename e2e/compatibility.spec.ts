import { openDisclosure } from './ui'
import { expect, test } from '@playwright/test'
import { newCard, newOffer } from '../shared/offers'
import { join } from 'node:path'

for (const width of [1280, 640]) {
  test(`manual import, keyboard review, journal and reflow at ${width}px`, async ({ page, browserName }) => {
    await page.setViewportSize({ width, height: 900 })
    const errors: string[] = [], posts: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', entry => { if (entry.type() === 'error') errors.push(entry.text()) })
    page.on('request', request => { if (request.method() === 'POST') posts.push(request.url()) })
    await page.goto('/')
    const offer = { ...newOffer(), cards: [{ ...newCard(), name: 'A long Fate name for keyboard and narrow-screen review' }] }
    await page.getByLabel('Import capture file').setInputFiles({ name: 'manual-offer.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(offer)) })
    await expect(page.getByRole('heading', { name: 'Archived offer', exact: true })).toBeVisible()
    await page.getByText('Edit details', { exact: true }).focus()
    await page.keyboard.press('Enter')
    await page.getByLabel('Notes', { exact: true }).fill('Keyboard correction')
    await page.getByRole('button', { name: 'Save offer', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('.notice[role="status"]')).toContainText('saved on this device')
    await page.reload()
    await page.getByRole('button', { name: /Saved offers/ }).click()
    await page.getByLabel('Search offers').fill('long Fate')
    await expect(page.getByRole('button', { name: 'Open', exact: true })).toHaveCount(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    if (process.env.FATE_QA_DIR) await page.screenshot({ path: join(process.env.FATE_QA_DIR, `compat-${browserName}-${width}.png`), fullPage: true })
    await openDisclosure(page, '.archive-tools')
    await page.getByRole('button', { name: 'Export all data' }).click()
    await expect(page.getByRole('dialog', { name: 'Download your backup' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Export all data' })).toBeFocused()
    expect(errors).toEqual([]); expect(posts).toEqual([])
  })
}
