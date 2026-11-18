import { expect, test, type BrowserContext } from '@playwright/test'
import { action, capture, state } from './overlay-support'

async function installHost(context: BrowserContext, identified = true) {
  await context.addInitScript(identified => {
    if (identified) Object.defineProperty(window, '__fateCollectorDesktop', { value: 1 })
    const listeners: ((event: { data: unknown }) => void)[] = []
    const host = {
      addEventListener(_: string, listener: (event: { data: unknown }) => void) { listeners.push(listener) },
      async postMessage(request: { id: string; operation: string; path?: string; content?: string }) {
        try {
          const captures = await (await navigator.storage.getDirectory()).getDirectoryHandle('captures', { create: true })
          const bridge = await captures.getDirectoryHandle('.overlay', { create: true })
          let value: unknown = null
          if (request.operation === 'ready') value = { helperVersion: '0.7.0' }
          else if (request.operation === 'show' || request.operation === 'hide') document.documentElement.dataset.hostWindow = request.operation
          else {
            const folder = request.path?.startsWith('captures/.overlay') ? bridge : captures
            if (request.operation === 'list') {
              const entries = []
              for await (const entry of folder.values()) entries.push({ kind: entry.kind, name: entry.name })
              value = entries
            } else if (request.operation === 'read') {
              const file = await (await folder.getFileHandle(request.path!.split('/').at(-1)!)).getFile()
              if (file.size > 12 * 1024 * 1024) throw new DOMException('Capture is too large.', 'OperationError')
              value = { text: new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()), lastModified: file.lastModified }
            } else if (request.operation === 'write' && request.path === 'captures/.overlay/state.json') {
              const writer = await (await bridge.getFileHandle('state.json', { create: true })).createWritable()
              await writer.write(request.content!); await writer.close()
            } else throw new DOMException('Invalid operation.', 'NotAllowedError')
          }
          for (const listener of listeners) listener({ data: { protocol: 1, id: request.id, ok: true, value } })
        } catch (error) {
          for (const listener of listeners) listener({ data: { protocol: 1, id: request.id, ok: false, error: { code: error instanceof DOMException ? error.name : 'OperationError', message: 'Fixture operation failed.' } } })
        }
      },
    }
    const chrome = (window as Window & { chrome?: object }).chrome ?? {}
    Object.defineProperty(chrome, 'webview', { value: host })
    Object.defineProperty(window, 'chrome', { value: chrome })
    Object.defineProperty(window, 'showDirectoryPicker', { value: () => { throw new Error('Desktop must not ask for a browser folder picker.') } })
    // A real native host drives this event with its own Windows timer.
    setInterval(() => window.dispatchEvent(new Event('fate-desktop-tick')), 500)
  }, identified)
}

test('a website in another WebView remains a normal website', async ({ page, context }) => {
  await installHost(context, false)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Your current area', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Download Windows helper' })).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Local advisor' })).toHaveCount(0)
})

test('local advisor help points to calibration and the helper’s offline diagnostic ZIP', async ({ page, context }, info) => {
  await installHost(context)
  await page.goto('/')
  await page.getByRole('button', { name: 'Guide', exact: true }).click()
  const guide = page.getByRole('article')
  await expect(guide.getByRole('heading', { name: 'Calibrate the Fate panel' })).toBeVisible()
  await expect(guide).toContainText('Open local advisor')
  await expect(guide.getByRole('button', { name: 'Open local review' })).toHaveCount(0)
  await guide.getByRole('button', { name: 'Show framing diagram' }).click()
  await expect(guide.getByRole('heading', { name: 'Frame the Fate panel' })).toBeFocused()
  await page.getByRole('button', { name: 'Local backups' }).click()
  await expect(guide.getByRole('button', { name: /Back up fights and challenges/ })).toBeVisible()
  await expect(guide.getByRole('button', { name: /Share reviewed corrections/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Troubleshooting' }).click()
  await guide.getByRole('button', { name: 'Open diagnostics' }).click()
  await expect(page.getByRole('heading', { name: 'Report a problem.', exact: true })).toBeFocused()
  const report = page.locator('.diagnostics-panel')
  await expect(report).toContainText('Report a problem')
  await expect(report).toContainText('Generate report')
  await expect(report).toContainText('Save ZIP')
  await expect(report.getByRole('button')).toHaveCount(0)
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 800 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`desktop-diagnostics-${width}.png`), fullPage: true })
  }
})

test('local advisor connects without a picker, records choices and restores its collection after restart', async ({ page, context }) => {
  test.setTimeout(60_000)
  await installHost(context)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const requests: string[] = []
  context.on('request', request => { if (request.url().includes('/api/')) requests.push(request.url()) })
  await context.route('**/api/**', route => route.abort())
  await page.goto('/')
  await expect(page.getByText('Local advisor connected', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Download Windows helper' })).toHaveCount(0)
  await page.evaluate(async () => {
    const folder = await (await navigator.storage.getDirectory()).getDirectoryHandle('captures')
    const file = await folder.getFileHandle(`auto-fate-${crypto.randomUUID()}.json`, { create: true })
    const writer = await file.createWritable(); await writer.write(new Uint8Array([255, 254, 255])); await writer.close()
  })
  // A native UTF-8 read failure must not stop later valid offers or heartbeat.
  await capture(page, true)
  await action(page, 'use-offer')
  await expect.poll(async () => (await state(page))?.actions.some(item => item.id.startsWith('collect:'))).toBe(true)
  await action(page, (await state(page))!.actions.find(item => item.id.startsWith('collect:'))!.id)
  await expect(page.locator('.collected-fates li')).toHaveCount(1)
  await page.getByRole('button', { name: 'Run in background' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-host-window', 'hide')
  await expect.poll(async () => (await state(page))?.status).toBe('collected')
  await page.close()
  const restarted = await context.newPage()
  restarted.on('pageerror', error => errors.push(error.message))
  await restarted.goto('/')
  await expect(restarted.getByText('Local advisor connected', { exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(restarted.locator('.collected-fates li')).toHaveCount(1)
  await expect.poll(async () => (await state(restarted))?.actions.some(item => item.id === 'continue-area')).toBe(true)
  await action(restarted, 'continue-area')
  await expect.poll(async () => (await state(restarted))?.status).toBe('collected')
  expect(requests).toEqual([])
  expect(errors).toEqual([])
})

test('local advisor layout and background control remain usable at narrow widths', async ({ page, context }, info) => {
  await installHost(context)
  await page.goto('/')
  await expect(page.getByText('Local advisor connected', { exact: true })).toBeVisible()
  for (const width of [1200, 760, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(page.getByRole('button', { name: 'Run in background' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    await page.screenshot({ path: info.outputPath(`desktop-${width}.png`), fullPage: true })
  }
})
