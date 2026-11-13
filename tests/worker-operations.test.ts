import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, test, vi } from 'vitest'
import worker, { type Env } from '../worker'
import { digest } from '../worker/http'
// @ts-expect-error Maintainer CLI is plain JavaScript.
import { reviewQuery } from '../scripts/review-symbol-reports.mjs'

const origin = 'https://collector.test'
const secret = 'private report detail from dependency'
const token = 'a'.repeat(64)
const databases: DatabaseSync[] = []
afterEach(() => {
  for (const db of databases.splice(0)) db.close()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function setup() {
  const db = new DatabaseSync(':memory:')
  databases.push(db)
  const migrations = new URL('../migrations/', import.meta.url)
  for (const name of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) {
    db.exec(readFileSync(new URL(name, migrations), 'utf8'))
  }
  const adapter = { prepare(sql: string) {
    let args: string[] = []
    const statement = {
      bind(...values: string[]) { args = values; return statement },
      async first() { return db.prepare(sql).get(...args) ?? null },
      async run() { const result = db.prepare(sql).run(...args); return { meta: { changes: Number(result.changes) } } },
    }
    return statement
  } }
  const env: Env = {
    DB: adapter as unknown as D1Database,
    APP_ENV: 'local',
    ASSETS: { fetch: async () => new Response('static') } as unknown as Fetcher,
    DIAGNOSTIC_RATE_LIMITER: { limit: async () => ({ success: true }) },
    TURNSTILE_SECRET: 'test-only-secret',
    TURNSTILE_SITEKEY: 'test-sitekey',
    TURNSTILE_HOSTNAMES: 'collector.test',
  }
  const review = (command: string, ...args: string[]) => db.prepare(reviewQuery(command, args)).all()
  return { db, env, review }
}

async function insertReport(db: DatabaseSync, evidence = 'synthetic', expiresAt = new Date(Date.now() + 60 * 60_000).toISOString()) {
  const id = crypto.randomUUID()
  const report = { id, description: secret, icon: { dataBase64: evidence }, tooltip: { dataBase64: evidence } }
  db.prepare(`INSERT INTO symbol_reports (id, token_hash, content_hash, report_json, consent_version, consent_text, accepted_at, recorded_at, expires_at, payload_bytes)
    VALUES (?, ?, ?, ?, 'test', 'test', ?, ?, ?, 1)`).run(id, await digest(token), 'hash', JSON.stringify(report), new Date().toISOString(), new Date().toISOString(), expiresAt)
  return id
}

function check(env: Env, id: string, credential = token, site = origin) {
  return worker.fetch(new Request(`${origin}/api/symbol-reports/${id}/review-status`, {
    method: 'POST', headers: { Origin: site, 'X-Symbol-Token': credential },
  }), env)
}

test('review leases prevent double claims and old holders cannot decide after lease replacement', async () => {
  const { db, review } = setup()
  const id = await insertReport(db)
  const [winner] = review('claim', id, 'first')
  expect(review('claim', id, 'second')).toEqual([])
  expect(review('evidence', id, crypto.randomUUID())).toEqual([])
  expect(review('evidence', id, String(winner.claim_id))).toHaveLength(1)
  db.prepare("UPDATE symbol_report_reviews SET claim_until = '2000-01-01T00:00:00.000Z' WHERE report_id = ?").run(id)
  const [replacement] = review('claim', id, 'second')
  expect(replacement.claim_id).not.toBe(winner.claim_id)
  expect(review('decide', id, String(winner.claim_id), 'accepted', 'verified')).toEqual([])
  expect(review('decide', id, String(replacement.claim_id), 'conflict', 'conflicting-evidence')).toMatchObject([{ status: 'conflict', reviewer: 'second' }])
  expect(review('claim', id, 'third')).toEqual([])
})

test('exact image duplicates cannot both be accepted and provenance is recorded separately', async () => {
  const { db, review } = setup()
  const [id, duplicate, other] = await Promise.all([insertReport(db), insertReport(db), insertReport(db, 'different')])
  const [firstClaim] = review('claim', id, 'first')
  const [secondClaim] = review('claim', duplicate, 'second')
  expect(review('evidence', duplicate, String(secondClaim.claim_id))).toMatchObject([{ possible_duplicate_ids: JSON.stringify([id]) }])
  expect(review('decide', duplicate, String(secondClaim.claim_id), 'rejected', 'duplicate', id)).toEqual([])
  expect(review('decide', id, String(firstClaim.claim_id), 'accepted', 'verified')).toHaveLength(1)
  expect(review('decide', duplicate, String(secondClaim.claim_id), 'accepted', 'verified')).toEqual([])
  expect(review('decide', duplicate, String(secondClaim.claim_id), 'rejected', 'duplicate', other)).toEqual([])
  expect(review('decide', duplicate, String(secondClaim.claim_id), 'rejected', 'duplicate', id)).toMatchObject([{ duplicate_of: id }])
  const revision = 'a'.repeat(40)
  expect(review('catalog', duplicate, 'operator', revision, 'reward-entry')).toEqual([])
  expect(review('catalog', id, 'operator', revision, 'reward-entry')).toMatchObject([{ catalog_revision: revision, catalog_entry: 'reward-entry' }])
  expect(review('catalog', id, 'operator', 'b'.repeat(40), 'reward-entry')).toEqual([])
  expect(review('list', id)).toMatchObject([{ id, status: 'accepted', catalog_revision: revision }])
  expect(() => review('claim', id, "reviewer'; DELETE FROM symbol_reports")).toThrow('Invalid reviewer handle.')
})

test('report status requires the matching per-report token and exposes coarse active status only', async () => {
  const { db, env, review } = setup()
  const id = await insertReport(db)
  expect(await (await check(env, id)).json()).toEqual({ id, status: 'pending' })
  expect((await check(env, id, 'b'.repeat(64))).status).toBe(401)
  expect((await check(env, crypto.randomUUID())).status).toBe(401)
  expect((await check(env, id, token, 'https://other.test')).status).toBe(403)
  const [claim] = review('claim', id, 'private-reviewer')
  expect(await (await check(env, id)).json()).toEqual({ id, status: 'in-review' })
  review('decide', id, String(claim.claim_id), 'rejected', 'insufficient-evidence')
  expect(await (await check(env, id)).json()).toEqual({ id, status: 'rejected' })
  expect((await worker.fetch(new Request(`${origin}/api/symbol-reports/${id}/review`, { method: 'POST' }), env)).status).toBe(404)
  const expired = await insertReport(db, 'expired', '2000-01-01T00:00:00.000Z')
  expect(review('claim', expired, 'reviewer')).toEqual([])
  expect((await check(env, expired)).status).toBe(410)
  const withdrawn = await insertReport(db)
  const [activeClaim] = review('claim', withdrawn, 'reviewer')
  const now = new Date().toISOString()
  db.prepare('INSERT INTO symbol_withdrawals (id, token_hash, requested_at, withdrawn_at) VALUES (?, ?, ?, ?)').run(withdrawn, await digest(token), now, now)
  expect((await check(env, withdrawn)).status).toBe(410)
  expect((await check(env, withdrawn, 'b'.repeat(64))).status).toBe(401)
  expect(review('decide', withdrawn, String(activeClaim.claim_id), 'accepted', 'verified')).toEqual([])
  expect(db.prepare('SELECT * FROM symbol_report_reviews WHERE report_id = ?').get(withdrawn)).toBeUndefined()
})

test('structured error logs correlate to API responses and omit user inputs and raw failures', async () => {
  const { env } = setup()
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  const id = crypto.randomUUID()
  function send(bindings: Env) {
    return worker.fetch(new Request(`${origin}/api/symbol-reports?private=${encodeURIComponent(secret)}`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Turnstile-Token': token, 'X-Request-ID': secret },
      body: JSON.stringify({ report: { id, description: secret } }),
    }), bindings)
  }
  const configuration = await send({ ...env, TURNSTILE_SECRET: undefined })
  vi.stubGlobal('fetch', async () => { throw new Error(secret) })
  const external = await send(env)
  vi.stubGlobal('fetch', async () => Response.json({
    success: true, hostname: 'collector.test', action: 'symbol-report', cdata: id, challenge_ts: new Date().toISOString(),
  }))
  const failed = { ...env, DB: { prepare() { throw new Error(secret) } } as unknown as D1Database }
  const challenge = await send(failed)
  const database = await check(failed, id)
  const responses = [configuration, external, challenge, database]
  const codes = ['symbols_siteverify_configuration', 'symbols_siteverify_service', 'symbols_challenge_d1', 'symbols_d1']
  expect(new Set(responses.map(response => response.headers.get('X-Request-ID'))).size).toBe(4)
  for (const [index, response] of responses.entries()) {
    const requestId = response.headers.get('X-Request-ID')
    expect(requestId).toMatch(/^[a-f0-9-]{36}$/)
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain(secret)
    expect(log.mock.calls[index]).toEqual([{ event: 'api_failure', code: codes[index], requestId, status: 503, count: 1 }])
  }
  expect(JSON.stringify(log.mock.calls)).not.toContain(secret)
  expect(JSON.stringify(log.mock.calls)).not.toContain(token)
  expect(JSON.stringify(log.mock.calls)).not.toContain(id)
})

test('a failed diagnostic cleanup still completes symbol retention and marks the cron failed', async () => {
  const { db, env } = setup()
  const expired = await insertReport(db, 'expired', '2000-01-01T00:00:00.000Z')
  db.exec('DROP TABLE diagnostic_reports')
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  const completed = vi.spyOn(console, 'info').mockImplementation(() => {})
  await expect(worker.scheduled({} as ScheduledController, env)).rejects.toThrow('Retention cleanup failed.')
  expect(db.prepare('SELECT report_json FROM symbol_reports WHERE id = ?').get(expired)?.report_json).toBeNull()
  const requestId = errors.mock.calls[0][0].requestId
  expect(errors.mock.calls).toEqual([[{ event: 'retention_cleanup', task: 'diagnostics', status: 'd1_failed', requestId, count: 1 }]])
  expect(completed.mock.calls).toEqual([[{ event: 'retention_cleanup', task: 'symbols', status: 'completed', requestId, count: 1 }]])
})
