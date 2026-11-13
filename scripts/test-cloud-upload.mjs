import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join, dirname, basename } from 'node:path'
import { createServer, request } from 'node:http'
import assert from 'node:assert/strict'

if (process.platform !== 'win32') throw new Error('This integration test requires Windows PowerShell 5.1 and DPAPI.')
const state = await mkdtemp(join(tmpdir(), 'fate-upload-integration-'))
const wrangler = resolve('node_modules/wrangler/bin/wrangler.js')
const persist = ['--persist-to', join(state, 'd1')]
const ps = join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
// PowerShell 7 can leak its module path through npm into Windows PowerShell 5.1.
// Use that executable's own modules, as when launched by the desktop helper.
const nativeEnv = { ...process.env }
for (const key of Object.keys(nativeEnv)) if (key.toLowerCase() === 'psmodulepath') delete nativeEnv[key]
nativeEnv.PSModulePath = join(dirname(ps), 'Modules')
let worker
let relay
let output = ''
let captureRequests = 0
let consentRequests = 0
let withdrawalRequests = 0
async function run(command, args) {
  await new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', windowsHide: true, env: nativeEnv })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolveRun() : reject(new Error(`Integration subprocess exited ${code}.`)))
  })
}
async function phase(name, origin) {
  await run(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolve('tests/cloud-upload.integration.ps1'), '-Phase', name, '-StateDirectory', state, '-Origin', origin])
}
function queryCaptures() {
  const query = spawnSync(process.execPath, [wrangler, 'd1', 'execute', 'fate-collector', '--local', ...persist, '--json', '--command', 'SELECT id, payload_json, parsed_offer_json FROM capture_uploads ORDER BY id'], { encoding: 'utf8', windowsHide: true })
  assert.equal(query.status, 0, query.stderr)
  return JSON.parse(query.stdout)[0].results
}
try {
  await run(process.execPath, [wrangler, 'd1', 'migrations', 'apply', 'fate-collector', '--local', ...persist])
  worker = spawn(process.execPath, [wrangler, 'dev', '--local', '--ip', '127.0.0.1', '--port', '8791', '--var', 'COLLECTOR_CAPTURE_KEY:e2e-local-capture', ...persist], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  worker.stdout.on('data', chunk => { output = (output + chunk).slice(-12000) })
  worker.stderr.on('data', chunk => { output = (output + chunk).slice(-12000) })
  let ready = false
  for (let i = 0; i < 100; i++) {
    try {
      const response = await fetch('http://127.0.0.1:8791/api/status', { signal: AbortSignal.timeout(500) })
      ready = response.ok && (await response.json()).captureIngestionEnabled
    } catch { /* Local startup only. */ }
    if (ready) break
    if (worker.exitCode !== null) throw new Error(output)
    await new Promise(resolveWait => setTimeout(resolveWait, 200))
  }
  assert(ready, `Local Worker did not start. ${output}`)
  relay = createServer(async (req, res) => {
    try {
      assert.equal(req.method, 'POST')
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const body = Buffer.concat(chunks)
      const json = JSON.parse(body.toString('utf8'))
      assert(!body.includes('LOCAL_IMAGE_SENTINEL'))
      assert(!body.includes('LOCAL_LOG_SENTINEL'))
      if (req.url === '/api/captures') {
        captureRequests++
        assert.equal(consentRequests, 1, 'Capture sent before registering consent.')
        assert.match(req.headers['x-consent-id'], /^[0-9a-f-]{36}$/)
        assert.match(req.headers['x-consent-token'], /^[0-9a-f]{64}$/)
        assert.deepEqual(Object.keys(json.image).sort(), ['height', 'width'])
      } else if (req.url === '/api/consents') {
        consentRequests++
        assert.equal(json.scope, 'captures')
        assert.match(json.token, /^[0-9a-f]{64}$/)
        assert(json.text.endsWith(`Destination: http://${req.headers.host}`))
      } else {
        assert.match(req.url, /^\/api\/consents\/[0-9a-f-]{36}\/withdraw$/)
        withdrawalRequests++
        assert.equal(req.headers.authorization, undefined)
        assert.match(req.headers['x-consent-token'], /^[0-9a-f]{64}$/)
        assert.equal(typeof json.withdrawnAt, 'string')
      }
      // Preserve the public origin seen by the helper while connecting to workerd's own port.
      const upstream = request({ host: '127.0.0.1', port: 8791, path: req.url, method: 'POST', headers: req.headers }, response => {
        res.writeHead(response.statusCode, { 'Content-Type': 'application/json' })
        response.pipe(res)
      })
      upstream.on('error', () => { res.writeHead(502); res.end() })
      upstream.end(body)
    } catch (error) { res.writeHead(500); res.end(String(error)) }
  })
  // Reserve an available loopback port, then close it for the outage phase.
  await new Promise(resolveListen => relay.listen(0, '127.0.0.1', resolveListen))
  const port = relay.address().port
  await new Promise(resolveClose => relay.close(resolveClose))
  const origin = `http://127.0.0.1:${port}`
  await phase('Offline', origin)
  await new Promise(resolveListen => relay.listen(port, '127.0.0.1', resolveListen))
  await phase('Online', origin)
  await phase('LostReceipt', origin)
  assert.equal(consentRequests, 1, 'Exactly one consent registration expected.')
  assert.equal(captureRequests, 6, 'Exactly three accepted uploads and three idempotent retries expected.')
  const ids = JSON.parse(await readFile(join(state, 'test-ids.json'), 'utf8'))
  const rows = queryCaptures()
  assert.deepEqual(rows.map(row => row.id).sort(), ids.slice(0, 3).sort())
  assert(rows.some(row => JSON.parse(row.payload_json).ocr.status === 'error'), 'Failed OCR must reach D1.')
  assert(rows.every(row => JSON.parse(row.parsed_offer_json).reviewed === false))
  assert(rows.every(row => JSON.parse(row.payload_json).context.session.id))
  for (const row of rows) {
    assert.deepEqual(JSON.parse(row.payload_json).context.area, { source: 'client-log', category: 'map', areaId: 'MapWorldsDunes', areaLevel: 83 })
    assert.equal(JSON.parse(row.parsed_offer_json).areaCategory, 'map')
    assert.equal(JSON.parse(row.parsed_offer_json).areaLevel, 83)
  }
  const repeated = rows.find(row => row.id === ids[2])
  assert.equal(JSON.parse(repeated.payload_json).context.possibleDuplicate.ofCaptureId, ids[0])
  assert.equal(JSON.parse(repeated.parsed_offer_json).captureContext.session.sequence, 3)
  assert.equal(JSON.parse(repeated.parsed_offer_json).captureContext.possibleDuplicate.ofCaptureId, ids[0])
  relay.closeAllConnections()
  await new Promise(resolveClose => relay.close(resolveClose))
  await phase('WithdrawOffline', origin)
  await new Promise(resolveListen => relay.listen(port, '127.0.0.1', resolveListen))
  await phase('WithdrawOnline', origin)
  assert.equal(withdrawalRequests, 1, 'Expected one confirmed withdrawal after restart.')
  assert.equal(captureRequests, 6, 'Withdrawal must prevent further capture requests.')
  assert.equal(queryCaptures().length, 0, 'Withdrawal must delete the capture data from the collection.')
  console.log('Direct helper → Worker → D1 passed: consent registration, offline queue, receipt feedback, restart, image exclusion, deduplication, session/repeat metadata, failed OCR, fixture exclusion, and offline withdrawal.')
} finally {
  if (relay?.listening) await new Promise(resolveClose => relay.close(resolveClose))
  if (worker?.pid && worker.exitCode === null) {
    // Stop only this test's process tree (Wrangler owns the local workerd child).
    spawnSync('taskkill.exe', ['/PID', String(worker.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  }
  // mkdtemp produced this exact disposable directory; no user state is used.
  assert.equal(dirname(resolve(state)).toLowerCase(), resolve(tmpdir()).toLowerCase())
  assert(basename(state).startsWith('fate-upload-integration-'))
  await rm(state, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 })
}
