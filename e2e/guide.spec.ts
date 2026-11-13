import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { openPanel } from './ui'

test('guide preserves an edited map draft and opens local review without losing focus', async ({ page }) => {
  await page.goto('/')
  await openPanel(page, '.more-actions')
  await page.getByRole('button', { name: 'Load example', exact: true }).click()
  await openPanel(page, '.advanced-panel')
  await page.getByRole('textbox', { name: 'Notes', exact: true }).fill('Keep this unsaved correction')
  await page.getByRole('button', { name: 'Back to advice', exact: true }).click()
  const before = await page.evaluate(() => sessionStorage.getItem('fate-collector.advisor-area.v2'))

  await page.getByRole('navigation', { name: 'Main', exact: true }).getByRole('button', { name: 'Guide', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Helper & website guide' })).toBeFocused()
  await page.getByRole('button', { name: 'Using Fate Collector', exact: true }).click()
  await page.getByRole('button', { name: 'Backup & sharing', exact: true }).click()
  await page.locator('#guide-topic-upload').click()
  await page.getByRole('button', { name: 'Quick start', exact: true }).click()
  await page.getByRole('button', { name: 'Open local review', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Local review', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Open local review', exact: true })).toBeFocused()
  await page.getByRole('button', { name: 'Open current area', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Your current area', exact: true })).toBeFocused()
  await openPanel(page, '.advanced-panel')
  await expect(page.getByRole('textbox', { name: 'Notes', exact: true })).toHaveValue('Keep this unsaved correction')
  expect(await page.evaluate(() => sessionStorage.getItem('fate-collector.advisor-area.v2'))).toBe(before)
})

test('guide navigation and calibration diagram work by keyboard on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await openPanel(page, '.more-actions')
  await page.getByRole('button', { name: 'Setup & usage guide', exact: true }).click()
  await page.getByRole('button', { name: 'Show framing diagram', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Frame the Fate panel', exact: true })).toBeFocused()
  await page.getByRole('button', { name: 'F7 · Second corner', exact: true }).focus()
  await page.keyboard.press('Space')
  await expect(page.getByRole('button', { name: 'F7 · Second corner', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.guide-demo-instruction')).toContainText('lower-right corner')
  await page.getByRole('button', { name: 'F8 · Preview', exact: true }).click()
  await expect(page.locator('.guide-frame-diagram')).toHaveAttribute('data-step', '2')
  await expect(page.locator('.guide-demo-instruction')).toContainText('repeat F6 and F7')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Back to Quick start', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Show framing diagram', exact: true })).toBeFocused()
  await page.getByRole('button', { name: 'Backup & sharing', exact: true }).click()
  await page.locator('#guide-topic-backup').click()
  await page.getByRole('button', { name: 'Open saved offers', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Your observation journal.' })).toBeFocused()
})

test('guide shows one task at a time and returns keyboard focus from each help topic', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Guide', exact: true }).click()
  const article = page.getByRole('article')
  await expect(article.getByRole('heading', { name: 'Quick start', exact: true })).toBeVisible()
  await expect(article).not.toContainText('Cloud upload settings')
  await expect(article).not.toContainText('PowerShell')
  await expect(page.locator('.guide-frame-diagram')).toHaveCount(0)
  await page.getByRole('button', { name: 'Other browsers or manual entry', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Import or enter an offer', exact: true })).toBeFocused()
  await expect(article).toContainText('Add Fate manually')
  await expect(article).toContainText('does not run text recognition')
  await page.getByRole('button', { name: 'Back to Using Fate Collector', exact: true }).click()
  await expect(page.locator('#guide-topic-manual')).toBeFocused()

  for (const [section, topics] of [
    ['Backup & sharing', [['backup', 'Download every part.'], ['upload', 'Disconnecting the website folder does not stop uploads.'], ['symbols', 'separate consent'], ['corrections', 'reviewed-offer key']]],
    ['Troubleshooting', [['capture', 'Windows HDR off'], ['missing', 'Resume local review'], ['recognition', 'Windows OCR language'], ['storage', 'New helper files remain on disk.']]],
  ] as const) {
    await page.getByRole('button', { name: section, exact: true }).click()
    await expect(page.locator('#guide-title')).toBeFocused()
    await expect(page.getByRole('button', { name: section, exact: true })).toHaveAttribute('aria-current', 'page')
    for (const [id, text] of topics) {
      await page.locator(`#guide-topic-${id}`).focus()
      await page.keyboard.press('Enter')
      await expect(page.locator('#guide-title')).toBeFocused()
      await expect(article).toContainText(text)
      await expect(page.locator('.guide-topics')).toHaveCount(0)
      await page.getByRole('button', { name: `Back to ${section}`, exact: true }).click()
      await expect(page.locator(`#guide-topic-${id}`)).toBeFocused()
    }
  }
  await page.getByRole('button', { name: 'Open diagnostics', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Report a problem.', exact: true })).toBeFocused()
})

for (const theme of ['mineral', 'trail']) for (const width of [1440, 1024, 390]) {
  test(`guide is readable and accessible in ${theme} at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await page.addInitScript(value => localStorage.setItem('fate-collector.theme', value), theme)
    await page.goto('/')
    await page.getByRole('button', { name: 'Guide', exact: true }).click()
    await page.evaluate(() => document.fonts.ready)
    for (const section of ['Quick start', 'Using Fate Collector', 'Backup & sharing', 'Troubleshooting']) {
      await page.getByRole('navigation', { name: 'Guide sections', exact: true }).getByRole('button', { name: section, exact: true }).click()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      expect((await new AxeBuilder({ page }).include('.usage-guide').analyze()).violations).toEqual([])
      if (section === 'Quick start' || section === 'Backup & sharing') {
        await page.evaluate(() => window.scrollTo(0, 0))
        await page.screenshot({ path: testInfo.outputPath(`${theme}-${width}-${section === 'Quick start' ? 'start' : 'topics'}.png`), fullPage: true })
      }
    }
    if (width === 390) {
      // A 320px CSS viewport also covers the reflow width of a 640px window at 200% zoom.
      await page.setViewportSize({ width: 320, height: 700 })
      await page.getByRole('button', { name: 'Quick start', exact: true }).click()
      await page.getByRole('button', { name: 'Show framing diagram', exact: true }).click()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      expect((await new AxeBuilder({ page }).include('.usage-guide').analyze()).violations).toEqual([])
      await page.screenshot({ path: testInfo.outputPath(`${theme}-320-diagram.png`), fullPage: true })
    }
  })
}
