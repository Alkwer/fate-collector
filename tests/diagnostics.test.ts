import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { afterEach, expect, test, vi } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import worker, { type Env } from '../worker'
import { APP_VERSION, DIAGNOSTIC_VERSION, RETENTION_MS, diagnosticReportSchema, diagnosticText, type DiagnosticReport } from '../shared/diagnostics'
import { diagnosticZip, generateDiagnostic, sendDiagnostic, retryDiagnosticWithdrawals, withdrawDiagnostic } from '../src/lib/diagnostics'
import { clearDiagnosticLog, diagnosticEvents, logDiagnostic } from '../src/lib/diagnostic-log'

const open: DatabaseSync[] = []
afterEach(() => { for (const db of open.splice(0)) db.close(); vi.unstubAllGlobals() })
function setup() {
  const db = new DatabaseSync(':memory:'); open.push(db)
  const dir = new URL('../migrations/', import.meta.url)
  for (const name of readdirSync(dir).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(name, dir), 'utf8'))
  const hook: { beforeWrite?: (sql: string) => void } = {}
  const adapter = { prepare(sql: string) {
    let args: (string | number | null)[] = []
    const statement = { bind(...values: typeof args) { args = values; return statement }, async run() { hook.beforeWrite?.(sql); const result = db.prepare(sql).run(...args); return { meta: { changes: Number(result.changes) } } }, async first() { return db.prepare(sql).get(...args) ?? null } }
    return statement
  } }
  const env: Env = { DB: adapter as unknown as D1Database, ASSETS: { fetch: async () => new Response('html') } as unknown as Fetcher, COLLECTOR_CAPTURE_KEY: 'capture-secret', COLLECTOR_INGEST_KEY: 'review-secret', DIAGNOSTIC_RATE_LIMITER: { limit: async () => ({ success: true }) } }
  return { db, env, hook }
}
function report(): DiagnosticReport {
  return { kind: 'fate-collector.diagnostics', schemaVersion: 1, id: crypto.randomUUID(), generatedAt: new Date().toISOString(), source: 'website', appVersion: APP_VERSION, environment: 'local', runtime: { family: 'chromium', version: '131', platform: 'windows', online: true }, state: { storage: 'available', folderConnection: 'off', sharing: 'off', queue: { pending: 0, accepted: 0, rejected: 0, ignored: 0 } }, events: [{ at: new Date().toISOString(), code: 'import', outcome: 'error', httpStatus: null }] }
}
const submission = () => ({ report: report(), consent: { version: DIAGNOSTIC_VERSION, text: diagnosticText('https://collector.test'), acceptedAt: new Date().toISOString() }, token: randomBytes(32).toString('hex') })
function post(path: string, body: unknown, headers: Record<string, string> = {}) { return new Request(`https://collector.test${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }) }
const send = (body: unknown, env: Env, key = 'review-secret') => worker.fetch(post('/api/diagnostics', body, { Authorization: `Bearer ${key}` }), env)
const withdraw = (body: ReturnType<typeof submission>, env: Env, token = body.token) => worker.fetch(post(`/api/diagnostics/${body.report.id}/withdraw`, { withdrawnAt: new Date().toISOString() }, { 'X-Diagnostic-Token': token }), env)

test('diagnostics require independent exact consent and a collection key; no public read endpoint', async () => {
  const { db, env } = setup(); const body = submission()
  expect((await send(body, env, 'wrong')).status).toBe(401)
  expect((await send({ report: body.report }, env)).status).toBe(400)
  expect((await send({ ...body, consent: { ...body.consent, text: 'yes' } }, env)).status).toBe(409)
  expect((await send({ ...body, consent: { ...body.consent, acceptedAt: '2099-01-01T00:00:00Z' } }, env)).status).toBe(400)
  expect((await worker.fetch(new Request('https://collector.test/api/diagnostics'), env)).status).toBe(405)
  expect(db.prepare('SELECT count(*) AS n FROM diagnostic_reports').get()?.n).toBe(0)
})
test.each(['review-secret', 'capture-secret'])('records exact consent, immutable 30-day receipt and only a token hash with %s', async key => {
  const { db, env } = setup(); const body = submission()
  const response = await send(body, env, key); expect(response.status).toBe(201)
  const receipt = await response.json() as { receivedAt: string; expiresAt: string }
  expect(receipt).toMatchObject({ id: body.report.id, status: 'received', consent: body.consent })
  expect(Date.parse(receipt.expiresAt) - Date.parse(receipt.receivedAt)).toBe(RETENTION_MS)
  expect(await (await send(body, env, key)).json()).toEqual(receipt)
  const row = db.prepare('SELECT * FROM diagnostic_reports').get()!
  expect(row.consent_text).toBe(body.consent.text)
  expect(JSON.stringify(row)).not.toContain(body.token)
  expect(JSON.parse(String(row.report_json))).toEqual(body.report)
  expect((await send({ ...body, report: { ...body.report, environment: 'staging' } }, env, key)).status).toBe(409)
})
test('malicious raw fields, secret strings and oversized diagnostics fail closed', async () => {
  const { db, env } = setup(); const body = submission()
  const canary = 'Bearer VERY_SECRET_KEY C:\\Users\\private\\file.png user@example.com PRIVATE_OCR'
  const invalid = [
    { ...body, accessKey: canary },
    { ...body, report: { ...body.report, screenshot: canary } },
    { ...body, report: { ...body.report, runtime: { ...body.report.runtime, version: canary } } },
    { ...body, report: { ...body.report, events: [{ ...body.report.events[0], code: canary }] } },
    { ...body, report: { ...body.report, events: [{ ...body.report.events[0], message: canary }] } },
  ]
  for (const value of invalid) expect((await send(value, env)).status).toBe(400)
  expect((await send({ ...body, rawLog: 'x'.repeat(65536) }, env)).status).toBe(413)
  expect(db.prepare('SELECT count(*) AS n FROM diagnostic_reports').get()?.n).toBe(0)
})
test('withdrawal deletes only the report payload, keeps audit, rejects replay and does not need the collection key', async () => {
  const { db, env } = setup(); const a = submission(); const b = submission()
  await send(a, env); await send(b, env)
  expect((await withdraw(a, env, '0'.repeat(64))).status).toBe(401)
  const response = await withdraw(a, { ...env, COLLECTOR_CAPTURE_KEY: undefined, COLLECTOR_INGEST_KEY: undefined })
  expect(response.status).toBe(200)
  expect(await (await withdraw(a, env)).json()).toEqual(await response.json())
  const row = db.prepare('SELECT * FROM diagnostic_reports WHERE id = ?').get(a.report.id)!
  expect(row.report_json).toBeNull(); expect(row.consent_text).toBe(a.consent.text); expect(row.withdrawn_at).toBeTruthy()
  expect(db.prepare('SELECT report_json FROM diagnostic_reports WHERE id = ?').get(b.report.id)?.report_json).toBeTruthy()
  expect((await send(a, env)).status).toBe(410)
})
test('withdrawal before or during a delayed upload prevents restoring its payload', async () => {
  const { db, env, hook } = setup(); const a = submission()
  await withdraw(a, env); expect((await send(a, env)).status).toBe(410)
  const b = submission()
  hook.beforeWrite = sql => {
    if (sql.startsWith('INSERT INTO diagnostic_reports')) {
      hook.beforeWrite = undefined
      db.prepare('INSERT INTO diagnostic_withdrawals (id,token_hash,requested_at,withdrawn_at) VALUES (?, ?, ?, ?)').run(b.report.id, 'irrelevant-for-insert-gate', new Date().toISOString(), new Date().toISOString())
    }
  }
  expect((await send(b, env)).status).toBe(410)
  expect(db.prepare('SELECT count(*) AS n FROM diagnostic_reports').get()?.n).toBe(0)
})
test('scheduled retention removes expired payloads, preserves fresh reports and cannot be extended by retries', async () => {
  const { db, env } = setup(); const expired = submission(); const fresh = submission()
  await send(expired, env); await send(fresh, env)
  db.prepare('UPDATE diagnostic_reports SET expires_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', expired.report.id)
  await worker.scheduled({} as ScheduledController, env)
  expect(db.prepare('SELECT report_json FROM diagnostic_reports WHERE id = ?').get(expired.report.id)?.report_json).toBeNull()
  expect(db.prepare('SELECT report_json FROM diagnostic_reports WHERE id = ?').get(fresh.report.id)?.report_json).toBeTruthy()
  expect((await send(expired, env)).status).toBe(410)
  expect(db.prepare('SELECT expires_at FROM diagnostic_reports WHERE id = ?').get(expired.report.id)?.expires_at).toBe('2020-01-01T00:00:00.000Z')
})
test('edge throttling rejects before reading a request body or touching D1 and fails closed on limiter failure', async () => {
  const { db, env } = setup(); const body = submission()
  const keys: string[] = []
  env.DIAGNOSTIC_RATE_LIMITER = { limit: async ({ key }) => { keys.push(key); return { success: false } } }
  const response = await send(body, env)
  expect(response.status).toBe(429); expect(response.headers.get('Retry-After')).toBe('60')
  expect(JSON.stringify(keys)).not.toContain('capture-secret')
  expect(db.prepare('SELECT count(*) AS n FROM diagnostic_reports').get()?.n).toBe(0)
  env.DIAGNOSTIC_RATE_LIMITER = undefined
  expect((await send(body, env)).status).toBe(503)
})
test('daily report quota is atomic, counts deleted reports, permits duplicate receipts and permits known-report deletion', async () => {
  const { db, env } = setup(); const original = submission()
  await send(original, env)
  for (let i = 1; i < 100; i++) {
    db.prepare(`INSERT INTO diagnostic_reports SELECT ?, token_hash, content_hash, report_json, consent_version, consent_text, accepted_at, recorded_at, expires_at, withdrawn_at FROM diagnostic_reports WHERE id = ?`).run(crypto.randomUUID(), original.report.id)
  }
  const blocked = await send(submission(), env)
  expect(blocked.status).toBe(429); expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0)
  expect((await send(original, env)).status).toBe(200)
  expect((await withdraw(original, env)).status).toBe(200)
  expect((await send(submission(), env)).status).toBe(429)
  expect(db.prepare('SELECT count(*) AS n FROM diagnostic_reports').get()?.n).toBe(100)
  expect(db.prepare('SELECT unknown_report FROM diagnostic_withdrawals WHERE id = ?').get(original.report.id)?.unknown_report).toBe(0)
})
test('unknown deletion attempts have a separate hard quota and cannot block deletion of an existing report', async () => {
  const { db, env } = setup(); const known = submission(); await send(known, env)
  const now = new Date().toISOString()
  for (let i = 0; i < 100; i++) db.prepare('INSERT INTO diagnostic_withdrawals (id,token_hash,requested_at,withdrawn_at) VALUES (?,?,?,?)').run(crypto.randomUUID(), 'hash', now, now)
  expect((await withdraw(submission(), env)).status).toBe(429)
  expect((await withdraw(known, env)).status).toBe(200)
  expect(db.prepare('SELECT count(*) AS n FROM diagnostic_withdrawals WHERE unknown_report=1').get()?.n).toBe(100)
})
function browserState() {
  const values = new Map<string, string>()
  const storage = { get length() { return values.size }, key: (index: number) => [...values.keys()][index] || null, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
  vi.stubGlobal('localStorage', storage); vi.stubGlobal('window', new EventTarget()); vi.stubGlobal('location', { origin: 'https://collector.test' })
  vi.stubGlobal('navigator', { userAgent: 'Windows Chrome/131.0 PRIVATE_BROWSER_STRING', onLine: false })
  clearDiagnosticLog()
  return storage
}
test('generated preview and ZIP exclude canaries, raw logs, identities and credentials; event log is bounded', () => {
  const storage = browserState()
  storage.setItem('fate-collector.consent.observations.active', 'PRIVATE_CONSENT_ID')
  storage.setItem('unrelated', 'PRIVATE_OCR PRIVATE_KEY PRIVATE_PATH')
  storage.setItem('fate-collector.diagnostic-events.v1', JSON.stringify([{ at: new Date().toISOString(), code: 'runtime-error', outcome: 'error', httpStatus: null, message: 'PRIVATE_EXCEPTION' }]))
  logDiagnostic('PRIVATE_CODE', 'error')
  for (let i = 0; i < 120; i++) logDiagnostic('import', 'error')
  const generated = generateDiagnostic('PRIVATE_ORIGIN', 'off', 'off')
  expect(generated.events.length).toBeLessThanOrEqual(100)
  expect(generated.runtime).toMatchObject({ family: 'chromium', version: '131' })
  expect(JSON.stringify(generated)).not.toContain('PRIVATE_')
  const archive = unzipSync(diagnosticZip(generated))
  expect(Object.keys(archive)).toEqual(['diagnostics.json'])
  expect(JSON.parse(strFromU8(archive['diagnostics.json']))).toEqual(generated)
  expect(() => diagnosticZip({ ...generated, token: 'secret' } as DiagnosticReport)).toThrow()
  expect(diagnosticReportSchema.safeParse(generated).success).toBe(true)
  expect(diagnosticEvents().length).toBeLessThanOrEqual(100)
})
test('no network request is made without explicit choice or if the deletion credential cannot be saved', async () => {
  const storage = browserState(); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
  await expect(sendDiagnostic(report(), 'key', false)).rejects.toThrow('tick the checkbox')
  storage.setItem = () => { throw new Error('Storage unavailable') }
  await expect(sendDiagnostic(report(), 'key', true)).rejects.toThrow('Storage unavailable')
  expect(fetch).not.toHaveBeenCalled()
})
test('client honors Retry-After for explicit sending and automatic deletion across repeated attempts', async () => {
  browserState()
  const fetch = vi.fn(async () => new Response('{}', { status: 429, headers: { 'Retry-After': '3600' } })); vi.stubGlobal('fetch', fetch)
  const value = report()
  await expect(sendDiagnostic(value, 'key', true)).rejects.toThrow('limit reached')
  await expect(sendDiagnostic(value, 'key', true)).rejects.toThrow('limit reached')
  expect(fetch).toHaveBeenCalledTimes(1)
  await expect(withdrawDiagnostic(value.id)).rejects.toThrow('Deletion is pending')
  await retryDiagnosticWithdrawals()
  expect(fetch).toHaveBeenCalledTimes(2)
})
