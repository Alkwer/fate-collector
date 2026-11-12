import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { afterEach, expect, test, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { crc32, deflateSync } from 'node:zlib'
import worker, { type Env } from '../worker'
import { SYMBOL_REPORT_VERSION, SYMBOL_RETENTION_MS, symbolConsentText, symbolReportSchema, type SymbolSubmission } from '../shared/symbol-reports'
import { saveSymbolSubmission, sendSymbolReport, symbolReportHistory, withdrawSymbolReport } from '../src/lib/symbol-reports'
// @ts-expect-error Maintainer CLI is plain JavaScript.
import { reviewReports } from '../scripts/export-symbol-reports.mjs'

const databases: DatabaseSync[] = []
test('valid PNG checksums cannot hide invalid scanlines, compressed payloads, metadata or pixel bombs', async () => {
  const { env } = setup(), body = submission()
  function chunk(kind: string, data: Buffer) {
    const result = Buffer.alloc(data.length + 12); result.writeUInt32BE(data.length); result.write(kind, 4); data.copy(result, 8)
    result.writeUInt32BE(crc32(result.subarray(4, -4)), result.length - 4); return result
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(8); header.writeUInt32BE(8, 4); header[8] = 8; header[9] = 6
  function png(data: Buffer, metadata = false) {
    return { mimeType: 'image/png', width: 8, height: 8, dataBase64: Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), ...(metadata ? [chunk('tEXt', Buffer.from('private metadata'))] : []), chunk('IDAT', data), chunk('IEND', Buffer.alloc(0))]).toString('base64') }
  }
  const valid = deflateSync(Buffer.alloc(8 * 33))
  expect((await send({ ...body, report: { ...body.report, icon: png(valid) } }, env)).status).toBe(200)
  for (const icon of [png(Buffer.alloc(0)), png(deflateSync(Buffer.alloc(4 * 1024 * 1024))), png(deflateSync(Buffer.alloc(8 * 33, 9))), png(valid, true)]) {
    const candidate = submission()
    expect((await send({ ...candidate, report: { ...candidate.report, icon } }, env)).status).toBe(400)
  }
})
test('maintainer export excludes withdrawn/expired reports and rejects ID collisions', () => {
  const body = submission(), future = new Date(Date.now() + 100000).toISOString()
  const row = { id: body.report.id, report_json: JSON.stringify(body.report), expires_at: future, withdrawn_at: null }
  expect(reviewReports([{ results: [row, { ...row, report_json: null }, { ...row, expires_at: '2020-01-01T00:00:00Z' }, { ...row, withdrawn_at: future }] }])).toHaveLength(1)
  expect(() => reviewReports([{ results: [row, row] }])).toThrow('Duplicate')
  expect(() => reviewReports([{ results: [{ ...row, id: crypto.randomUUID() }] }])).toThrow('mismatched')
})
test('a terminal server response persists after a lost receipt and disables subsequent upload retries', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('location', { origin: 'https://collector.test' })
  const body = submission(); await saveSymbolSubmission(body)
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Expired' }), { status: 410 })); vi.stubGlobal('fetch', fetch)
  await expect(sendSymbolReport(body.report.id, 'review-secret')).rejects.toThrow('Expired')
  expect((await symbolReportHistory())[0].expired).toBe(true)
  await expect(sendSymbolReport(body.report.id, 'review-secret')).rejects.toThrow('expired')
  expect(fetch).toHaveBeenCalledTimes(1)
})
afterEach(() => { databases.splice(0).forEach(db => db.close()); vi.unstubAllGlobals() })
function setup() {
  const db = new DatabaseSync(':memory:'); databases.push(db)
  const dir = new URL('../migrations/', import.meta.url)
  for (const name of readdirSync(dir).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(name, dir), 'utf8'))
  const adapter = { prepare(sql: string) {
    let args: (string | number | null)[] = []
    const statement = { bind(...values: typeof args) { args = values; return statement }, async run() { const result = db.prepare(sql).run(...args); return { meta: { changes: Number(result.changes) } } }, async first() { return db.prepare(sql).get(...args) ?? null } }
    return statement
  } }
  const env: Env = { DB: adapter as unknown as D1Database, ASSETS: { fetch: async () => new Response('html') } as unknown as Fetcher, COLLECTOR_INGEST_KEY: 'review-secret', COLLECTOR_CAPTURE_KEY: 'capture-secret', DIAGNOSTIC_RATE_LIMITER: { limit: async () => ({ success: true }) } }
  return { db, env }
}
function submission(): SymbolSubmission {
  const bytes = readFileSync(new URL('../public/game-art/reward-gold-grid.png', import.meta.url))
  const image = { mimeType: 'image/png' as const, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), dataBase64: bytes.toString('base64') }
  return { report: { kind: 'fate-collector.symbol-report', schemaVersion: 1, id: crypto.randomUUID(), createdAt: new Date().toISOString(),
    offer: { id: crypto.randomUUID(), revision: 1, captureId: null, cardId: crypto.randomUUID(), cardName: 'SYNTHETIC TEST', rewardId: null, gameVersion: 'test', origin: 'test', areaLevel: null },
    label: '', rewardKind: 'unknown', threshold: null, description: 'SYNTHETIC', icon: image, tooltip: image },
    token: 'a'.repeat(64), consent: { version: SYMBOL_REPORT_VERSION, text: symbolConsentText('https://collector.test'), acceptedAt: new Date().toISOString() } }
}
function post(path: string, body: unknown, headers: Record<string, string> = {}) { return new Request(`https://collector.test${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }) }
const send = (body: unknown, env: Env, key = 'review-secret') => worker.fetch(post('/api/symbol-reports', body, { Authorization: `Bearer ${key}` }), env)
const withdraw = (body: SymbolSubmission, env: Env, token = body.token) => worker.fetch(post(`/api/symbol-reports/${body.report.id}/withdraw`, { withdrawnAt: new Date().toISOString() }, { 'X-Symbol-Token': token }), env)

test('images require a reviewed-offer key and their own exact consent; no public listing', async () => {
  const { db, env } = setup(), body = submission()
  for (const key of ['wrong', 'capture-secret', '']) expect((await send(body, env, key)).status).toBe(401)
  expect((await send({ report: body.report }, env)).status).toBe(400)
  expect((await send({ ...body, consent: { ...body.consent, text: 'I agree' } }, env)).status).toBe(409)
  expect((await worker.fetch(new Request('https://collector.test/api/symbol-reports'), env)).status).toBe(405)
  expect(db.prepare('SELECT count(*) AS n FROM symbol_reports').get()?.n).toBe(0)
})
test('stores actual images, context and exact consent; retries are immutable and do not duplicate', async () => {
  const { db, env } = setup(), body = submission()
  const first = await send(body, env); expect(first.status).toBe(200)
  const receipt = await first.json() as { receivedAt: string; expiresAt: string }
  expect(Date.parse(receipt.expiresAt) - Date.parse(receipt.receivedAt)).toBe(SYMBOL_RETENTION_MS)
  expect(await (await send(body, env)).json()).toEqual(receipt)
  const stored = db.prepare('SELECT * FROM symbol_reports').get()!
  expect(JSON.parse(String(stored.report_json))).toEqual(body.report)
  expect(stored.consent_text).toBe(body.consent.text)
  expect(stored.token_hash).not.toBe(body.token)
  expect((await send({ ...body, report: { ...body.report, label: 'Changed' } }, env)).status).toBe(409)
  expect((await send({ ...body, token: 'b'.repeat(64) }, env)).status).toBe(409)
  expect(db.prepare('SELECT count(*) AS n FROM symbol_reports').get()?.n).toBe(1)
})
test('rejects fake PNGs, dimension mismatch, extra fields, future clocks and oversized requests', async () => {
  const { env } = setup(), body = submission()
  const reports = [
    { ...body.report, icon: { ...body.report.icon, width: 200 } },
    { ...body.report, icon: { ...body.report.icon, dataBase64: btoa('<svg onload="alert(1)"></svg>') } },
    { ...body.report, icon: { ...body.report.icon, dataBase64: body.report.icon.dataBase64.slice(0, -20) } },
    { ...body.report, rawScreenshot: 'extra' },
    { ...body.report, rewardKind: 'regular', threshold: 3 },
  ]
  for (const report of reports) expect((await send({ ...body, report }, env)).status).toBe(400)
  expect((await send({ ...body, consent: { ...body.consent, acceptedAt: '2099-01-01T00:00:00Z' } }, env)).status).toBe(400)
  expect((await send({ ...body, padding: 'x'.repeat(640 * 1024) }, env)).status).toBe(413)
  expect(symbolReportSchema.safeParse(body.report).success).toBe(true)
})
test('withdrawal works without collection key, isolates records and blocks late upload/replay', async () => {
  const { env, db } = setup(), body = submission(), other = submission()
  await send(body, env); await send(other, env)
  expect((await withdraw(body, env, 'f'.repeat(64))).status).toBe(401)
  expect((await withdraw(body, { ...env, COLLECTOR_INGEST_KEY: undefined })).status).toBe(200)
  expect(db.prepare('SELECT report_json FROM symbol_reports WHERE id = ?').get(body.report.id)?.report_json).toBeNull()
  expect(db.prepare('SELECT report_json FROM symbol_reports WHERE id = ?').get(other.report.id)?.report_json).not.toBeNull()
  expect((await send(body, env)).status).toBe(410)
  const beforeSend = submission()
  expect((await withdraw(beforeSend, env)).status).toBe(401)
  expect((await worker.fetch(post(`/api/symbol-reports/${beforeSend.report.id}/withdraw`, { withdrawnAt: new Date().toISOString() }, { 'X-Symbol-Token': beforeSend.token, Authorization: 'Bearer review-secret' }), env)).status).toBe(200)
  expect((await send(beforeSend, env)).status).toBe(410)
})
test('scheduled expiry removes content and forbids resubmitting an expired report', async () => {
  const { db, env } = setup(), body = submission()
  await send(body, env)
  db.prepare('UPDATE symbol_reports SET expires_at = ?').run('2020-01-01T00:00:00.000Z')
  await worker.scheduled({} as ScheduledController, env)
  expect(db.prepare('SELECT report_json FROM symbol_reports').get()?.report_json).toBeNull()
  expect((await send(body, env)).status).toBe(410)
})
test('fails closed on rate protection and enforces stored-byte and daily limits without blocking retries', async () => {
  const { db, env } = setup(), body = submission()
  expect((await send(body, { ...env, DIAGNOSTIC_RATE_LIMITER: undefined })).status).toBe(503)
  expect((await send(body, { ...env, DIAGNOSTIC_RATE_LIMITER: { limit: async () => ({ success: false }) } })).status).toBe(429)
  await send(body, env)
  db.prepare('UPDATE symbol_reports SET payload_bytes = ?').run(100 * 1024 * 1024)
  expect((await send(submission(), env)).status).toBe(429)
  expect((await send(body, env)).status).toBe(200)
  db.prepare('UPDATE symbol_reports SET payload_bytes = 1').run()
  for (let i = 0; i < 49; i++) expect((await send(submission(), env)).status).toBe(200)
  expect((await send(submission(), env)).status).toBe(429)
  expect((await send(body, env)).status).toBe(200)
})
test('client keeps offline reports, verifies receipts and makes withdrawal durable before network I/O', async () => {
  const { env } = setup(), body = submission()
  vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('location', { origin: 'https://collector.test' })
  await saveSymbolSubmission(body)
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
  await expect(sendSymbolReport(body.report.id, 'review-secret')).rejects.toThrow('offline')
  expect((await symbolReportHistory())[0].receipt).toBeNull()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'wrong', status: 'received' }))))
  await expect(sendSymbolReport(body.report.id, 'review-secret')).rejects.toThrow('Unexpected receipt')
  vi.stubGlobal('fetch', (path: string, init: RequestInit) => worker.fetch(new Request(`https://collector.test${path}`, init), env))
  await sendSymbolReport(body.report.id, 'review-secret')
  expect((await symbolReportHistory())[0].receipt?.id).toBe(body.report.id)
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
  await expect(withdrawSymbolReport(body.report.id)).rejects.toThrow('offline')
  expect((await symbolReportHistory())[0].withdrawRequestedAt).not.toBeNull()
  await expect(sendSymbolReport(body.report.id, 'review-secret')).rejects.toThrow('withdrawal request')
  vi.stubGlobal('fetch', (path: string, init: RequestInit) => worker.fetch(new Request(`https://collector.test${path}`, init), env))
  await withdrawSymbolReport(body.report.id)
  expect((await symbolReportHistory())[0].withdrawnAt).not.toBeNull()
})
