import { expect, test, type Browser } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { setup, capture, action, state } from './overlay-support'

test('keeps advice and capture intake current while the page is hidden', async ({ playwright }) => {
  test.setTimeout(75_000)
  // A normal Playwright context forces visibility on its own CDP session.
  // noDefaults on the real browser's default context avoids that override.
  const directory = resolve('.qa/overlay-browser')
  await mkdir(directory, { recursive: true })
  const profile = await mkdtemp(join(directory, 'profile-'))
  const child = spawn(playwright.chromium.executablePath(), [
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--start-minimized',
    '--no-first-run', '--no-default-browser-check',
    '--enable-features=IntensiveWakeUpThrottling:grace_period_seconds/10',
  ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
  let browser: Browser | undefined
  try {
  const endpoint = await new Promise<string>((resolveEndpoint, reject) => {
    const timer = setTimeout(() => reject(new Error('Chromium did not start.')), 15_000)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.stderr.on('data', chunk => {
      const match = String(chunk).match(/DevTools listening on (ws:\/\/\S+)/)
      if (match) { clearTimeout(timer); resolveEndpoint(match[1]) }
    })
  })
  browser = await playwright.chromium.connectOverCDP(endpoint, { noDefaults: true })
  const context = browser.contexts()[0]
    const page = await context.newPage()
    await setup(page, 'http://127.0.0.1:8790')
    await capture(page)
    await action(page, 'use-offer')
    const observer = await context.newPage()
    await observer.route('**/background-probe', route => route.fulfill({ contentType: 'text/html', body: '<title>Background overlay test</title>' }))
    await observer.goto('http://127.0.0.1:8790/background-probe')
    await observer.bringToFront()
    const cdp = await context.newCDPSession(page)
    const { windowId } = await cdp.send('Browser.getWindowForTarget')
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } })
    await expect.poll(() => page.evaluate(() => document.hidden)).toBe(true)
    // Also exceed the 30-second silent-page condition. Observe through the
    // second document so test evaluation never wakes the application page.
    await observer.waitForTimeout(35_000)
    const heartbeat = (await state(observer))!
    expect(Date.now() - heartbeat.writtenAt).toBeLessThan(5000)
    await capture(observer)
    await action(observer, 'use-offer')
    await expect.poll(async () => (await state(observer))?.rows.length).toBe(1)
  } finally {
    if (browser) {
      const session = await browser.newBrowserCDPSession().catch(() => null)
      await session?.send('Browser.close').catch(() => undefined)
      await browser.close().catch(() => undefined)
    }
    if (child.exitCode === null) child.kill()
  }
})
