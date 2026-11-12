import { resolve } from 'node:path'
import { spawnSync, spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
const wrangler = resolve('node_modules/wrangler/bin/wrangler.js')
const common = ['--persist-to', '.wrangler/e2e-state']
const migration = spawnSync(process.execPath, [wrangler, 'd1', 'migrations', 'apply', 'fate-collector', '--local', ...common], { stdio: 'inherit' })
if (migration.status !== 0) process.exit(migration.status || 1)
// Test-only entrypoint: mock the external verifier, never add a bypass to the shipped Worker.
mkdirSync('.wrangler', { recursive: true })
writeFileSync('.wrangler/e2e-worker.ts', `
import worker from '../worker/index'
const original = globalThis.fetch
globalThis.fetch = async (input, init) => {
  if (String(input) !== 'https://challenges.cloudflare.com/turnstile/v0/siteverify') return original(input, init)
  const body = new URLSearchParams(String(init?.body)), parts = (body.get('response') || '').split(':')
  if (body.get('secret') !== 'local-e2e-secret' || parts.length !== 4 || parts[0] !== 'e2e') return Response.json({success:false,'error-codes':['invalid-input-response']})
  return Response.json({success:true,hostname:'127.0.0.1',action:parts[1],cdata:parts[2],challenge_ts:new Date().toISOString()})
}
export default { ...worker, fetch(request, env) {
  const headers = new Headers(request.headers)
  headers.set('CF-Connecting-IP', headers.get('X-E2E-Source') || '127.0.0.1')
  return worker.fetch(new Request(request, { headers }), env)
} }
`)
const child = spawn(process.execPath, [wrangler, 'dev', '.wrangler/e2e-worker.ts', '--local', '--ip', '127.0.0.1', '--port', '8790', '--var', 'COLLECTOR_INGEST_KEY:e2e-local-only',
  '--var', 'TURNSTILE_SECRET:local-e2e-secret', '--var', 'TURNSTILE_SITEKEY:local-e2e-sitekey', '--var', 'TURNSTILE_HOSTNAMES:127.0.0.1', ...common], { stdio: 'inherit' })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('exit', code => process.exit(code || 0))
