import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join, dirname, basename } from 'node:path'
import { createServer } from 'node:http'
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
let requests = 0
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
      requests++
      assert.equal(req.url, '/api/captures')
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const body = Buffer.concat(chunks).toString('utf8')
      assert(!body.includes('LOCAL_IMAGE_SENTINEL'))
      assert.deepEqual(Object.keys(JSON.parse(body).image).sort(), ['height', 'width'])
      const response = await fetch('http://127.0.0.1:8791/api/captures', { method: 'POST', headers: { 'Content-Type': req.headers['content-type'], Authorization: req.headers.authorization }, body })
      res.writeHead(response.status, { 'Content-Type': 'application/json' })
      res.end(await response.text())
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
  assert.equal(requests, 6, 'Exactly three accepted uploads and three idempotent retries expected.')
  const ids = JSON.parse(await readFile(join(state, 'test-ids.json'), 'utf8'))
  const query = spawnSync(process.execPath, [wrangler, 'd1', 'execute', 'fate-collector', '--local', ...persist, '--json', '--command', 'SELECT id, payload_json, parsed_offer_json FROM capture_uploads ORDER BY id'], { encoding: 'utf8', windowsHide: true })
  assert.equal(query.status, 0, query.stderr)
  const rows = JSON.parse(query.stdout)[0].results
  assert.deepEqual(rows.map(row => row.id).sort(), ids.slice(0, 3).sort())
  assert(rows.some(row => JSON.parse(row.payload_json).ocr.status === 'error'), 'Failed OCR must reach D1.')
  assert(rows.every(row => JSON.parse(row.parsed_offer_json).reviewed === false))
  assert(rows.every(row => JSON.parse(row.payload_json).context.session.id))
  const repeated = rows.find(row => row.id === ids[2])
  assert.equal(JSON.parse(repeated.payload_json).context.possibleDuplicate.ofCaptureId, ids[0])
  assert.equal(JSON.parse(repeated.parsed_offer_json).captureContext.session.sequence, 3)
  assert.equal(JSON.parse(repeated.parsed_offer_json).captureContext.possibleDuplicate.ofCaptureId, ids[0])
  console.log('Direct helper → Worker → D1 passed: session/repeat metadata, receipt feedback, offline queue, restart, no images, no browser, duplicate retry, failed OCR and fixture exclusion.')
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
