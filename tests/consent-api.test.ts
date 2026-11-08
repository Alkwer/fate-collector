import { DatabaseSync } from 'node:sqlite'
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { afterEach, expect, test } from 'vitest'
import worker, { type Env } from '../worker'
import { CONSENT_VERSION, consentText, type ConsentGrant, type ConsentScope } from '../shared/consent'
import { newCard, newOffer } from '../shared/offers'

const databases: DatabaseSync[] = []
afterEach(() => { for (const db of databases.splice(0)) db.close() })
function setup() {
  const db = new DatabaseSync(':memory:'); databases.push(db)
  const migrations = new URL('../migrations/', import.meta.url)
  for (const name of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(name, migrations), 'utf8'))
  const hook: { beforeWrite?: (sql: string) => void } = {}
  const adapter = { prepare(sql: string) {
    let args: (string | number | null)[] = []
    const statement = { bind(...values: typeof args) { args = values; return statement },
      async run() { hook.beforeWrite?.(sql); const result = db.prepare(sql).run(...args); return { meta: { changes: Number(result.changes) } } },
      async first() { return db.prepare(sql).get(...args) ?? null } }
    return statement
  } }
  const env: Env = { DB: adapter as unknown as D1Database, ASSETS: { fetch: async () => new Response('html') } as unknown as Fetcher, COLLECTOR_CAPTURE_KEY: 'capture-key', COLLECTOR_INGEST_KEY: 'review-key' }
  return { db, env, hook }
}
function grant(scope: ConsentScope = 'captures'): ConsentGrant {
  return { id: crypto.randomUUID(), token: randomBytes(32).toString('hex'), scope, policyVersion: CONSENT_VERSION, acceptedAt: new Date(Date.now() - 1000).toISOString(), text: consentText(scope, 'https://collector.test') }
}
function request(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://collector.test${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
}
const key = (scope: ConsentScope) => scope === 'captures' ? 'capture-key' : 'review-key'
const register = (g: ConsentGrant, env: Env) => worker.fetch(request('/api/consents', g, { Authorization: `Bearer ${key(g.scope)}` }), env)
const withdraw = (g: ConsentGrant, env: Env, token = g.token) => worker.fetch(request(`/api/consents/${g.id}/withdraw`, { withdrawnAt: new Date().toISOString() }, { 'X-Consent-Token': token }), env)
function data(g: ConsentGrant, env: Env) {
  const body = g.scope === 'captures'
    ? { kind: 'fate-collector.upload', schemaVersion: 1, captureId: crypto.randomUUID(), capturedAt: new Date().toISOString(), source: 'windows-helper', helperVersion: '0.2.0', context: { captureMode: 'game' }, image: { width: 10, height: 10 }, ocr: { status: 'ok', text: 'Private text', lines: [], language: null } }
    : { ...newOffer(), origin: 'live', reviewed: true, completeness: 'partial', cards: [{ ...newCard(), name: 'Test card' }] }
  return worker.fetch(request(`/api/${g.scope}`, body, { Authorization: `Bearer ${key(g.scope)}`, 'X-Consent-Id': g.id, 'X-Consent-Token': g.token }), env)
}
test('records the exact consent text, client acceptance date and server receipt; retries preserve them', async () => {
  const { db, env } = setup(); const g = grant()
  const response = await register(g, env); expect(response.status).toBe(201)
  const receipt = await response.json()
  expect(receipt).toMatchObject({ id: g.id, text: g.text, acceptedAt: g.acceptedAt, policyVersion: CONSENT_VERSION, withdrawnAt: null })
  expect(await (await register(g, env)).json()).toEqual(receipt)
  const stored = db.prepare('SELECT * FROM data_consents').get()!
  expect(stored.consent_text).toBe(g.text)
  expect(stored.token_hash).not.toBe(g.token)
  expect(JSON.stringify(receipt)).not.toContain(g.token)
})
test('rejects absent consent, forged content, stale policy, future dates and mismatched scope/key', async () => {
  const { env } = setup(); const g = grant()
  expect((await worker.fetch(request('/api/captures', {}, { Authorization: 'Bearer capture-key' }), env)).status).toBe(428)
  expect((await data(g, env)).status).toBe(403)
  expect((await register({ ...g, text: 'I agree' }, env)).status).toBe(409)
  expect((await register({ ...g, policyVersion: 'old' }, env)).status).toBe(409)
  expect((await register({ ...g, acceptedAt: '2099-01-01T00:00:00.000Z' }, env)).status).toBe(400)
  expect((await worker.fetch(request('/api/consents', g, { Authorization: 'Bearer review-key' }), env)).status).toBe(401)
  await register(g, env)
  expect((await data({ ...g, scope: 'observations' }, env)).status).toBe(403)
  expect((await data({ ...g, token: '0'.repeat(64) }, env)).status).toBe(403)
})
test('withdrawal deletes only this consent contributions, keeps the audit, and works without collection keys', async () => {
  const { db, env } = setup(); const a = grant(); const b = grant('observations')
  await register(a, env); await register(b, env)
  expect((await data(a, env)).status).toBe(201); expect((await data(b, env)).status).toBe(201)
  expect((await withdraw(a, env, '0'.repeat(64))).status).toBe(401)
  const response = await withdraw(a, { ...env, COLLECTOR_CAPTURE_KEY: undefined, COLLECTOR_INGEST_KEY: undefined })
  expect(response.status).toBe(200)
  const receipt = await response.json()
  expect(await (await withdraw(a, env)).json()).toEqual(receipt)
  expect(db.prepare('SELECT count(*) AS n FROM capture_uploads').get()?.n).toBe(0)
  expect(db.prepare('SELECT count(*) AS n FROM observations').get()?.n).toBe(1)
  expect(db.prepare('SELECT consent_text FROM data_consents WHERE id = ?').get(a.id)?.consent_text).toBe(a.text)
  expect((await data(a, env)).status).toBe(403)
  expect((await register(a, env)).status).toBe(403)
})
test('withdrawal before a lost grant acknowledgement prevents delayed registration from restoring consent', async () => {
  const { db, env } = setup(); const g = grant()
  expect((await withdraw(g, env)).status).toBe(200)
  expect((await register(g, env)).status).toBe(403)
  expect((await data(g, env)).status).toBe(403)
  expect(db.prepare('SELECT count(*) AS n FROM data_consents').get()?.n).toBe(0)
  const fresh = grant(); expect((await register(fresh, env)).status).toBe(201)
  expect((await data(fresh, env)).status).toBe(201)
})
test.each(['captures', 'observations'] as const)('withdrawal racing a %s insert cannot leave a late row', async scope => {
  const { db, env, hook } = setup(); const g = grant(scope); await register(g, env)
  hook.beforeWrite = sql => {
    if (sql.startsWith('INSERT INTO ' + (scope === 'captures' ? 'capture_uploads' : 'observations'))) {
      hook.beforeWrite = undefined
      db.prepare('INSERT INTO consent_withdrawals VALUES (?, ?, ?, ?)').run(g.id, createHash('sha256').update(g.token).digest('hex'), new Date().toISOString(), new Date().toISOString())
    }
  }
  expect((await data(g, env)).status).toBe(403)
  expect(db.prepare('SELECT count(*) AS n FROM research_observations').get()?.n).toBe(0)
})
test('a new policy blocks old consent while still allowing its withdrawal', async () => {
  const { db, env } = setup(); const g = grant(); await register(g, env)
  db.prepare('UPDATE data_consents SET policy_version = ? WHERE id = ?').run('older-version', g.id)
  expect((await data(g, env)).status).toBe(403)
  expect((await withdraw(g, env)).status).toBe(200)
})
test('consent is tied to the destination and old captures cannot be backfilled', async () => {
  const { env } = setup(); const g = grant(); await register(g, env)
  const payload = { kind: 'fate-collector.upload', schemaVersion: 1, captureId: crypto.randomUUID(), capturedAt: '2020-01-01T00:00:00Z', source: 'windows-helper', helperVersion: '0.2.0', context: { captureMode: 'game' }, image: { width: 10, height: 10 }, ocr: { status: 'ok', text: '', lines: [], language: null } }
  const headers = { Authorization: 'Bearer capture-key', 'X-Consent-Id': g.id, 'X-Consent-Token': g.token }
  expect((await worker.fetch(request('/api/captures', payload, headers), env)).status).toBe(422)
  expect((await register({ ...grant(), text: consentText('captures', 'https://another.test') }, env)).status).toBe(409)
})
