import { createServer } from 'vite'
import { chromium } from '@playwright/test'

// Isolated Chromium profile, real IndexedDB and production reader module.
// Enumeration is synthetic: these timings isolate receipt lookup cost, not disk I/O.
const server = await createServer({ configFile: false, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } })
let browser
try {
  await server.listen()
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const url = server.resolvedUrls.local[0]
  await page.route(url, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Isolated scan benchmark</title>' }))
  await page.goto(url)
  const result = await page.evaluate(async () => {
    const storage = await import('/src/lib/storage.ts')
    const { CaptureReader } = await import('/src/lib/capture-sync.ts')
    await storage.listOffers()
    const db = await new Promise((resolve, reject) => {
      const open = indexedDB.open('fate-collector'); open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error)
    })
    const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
    const results = []
    try {
      for (const count of [1000, 10000]) {
        const ids = Array.from({ length: count }, () => crypto.randomUUID())
        await new Promise((resolve, reject) => {
          const tx = db.transaction('captureReceipts', 'readwrite'), store = tx.objectStore('captureReceipts')
          store.clear(); ids.forEach(id => store.put({ id }))
          tx.oncomplete = resolve; tx.onerror = () => reject(tx.error)
        })
        const folder = { queryPermission: async () => 'granted', values: async function* () {
          for (const id of ids) yield { kind: 'file', name: `fate-${id}.json`, getFile() { throw new Error('Already handled evidence must not be read') } }
        } }
        const baseline = [], cold = [], warm = []
        for (let pass = 0; pass < 3; pass++) {
          let start = performance.now()
          for (const id of ids) if (!await storage.hasCaptureReceipt(id)) throw new Error('Missing baseline receipt')
          baseline.push(performance.now() - start)
          const reader = new CaptureReader()
          start = performance.now(); await reader.scan(folder, async () => {}, () => false); cold.push(performance.now() - start)
          start = performance.now(); await reader.scan(folder, async () => {}, () => false); warm.push(performance.now() - start)
        }
        results.push({ files: count, repetitions: 3, baselineReceiptLookupMs: median(baseline), coldScanMs: median(cold), warmScanMs: median(warm) })
      }
    } finally { db.close() }
    return results
  })
  console.log(JSON.stringify({ runtime: 'Chromium IndexedDB; synthetic directory enumeration; no image reads', results: result }, null, 2))
} finally { await browser?.close(); await server.close() }
