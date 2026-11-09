import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { CONSENT_VERSION, consentText } from '../shared/consent'
import { readFileSync, readdirSync } from 'node:fs'
import { afterEach, expect, test } from 'vitest'
import worker, { type Env } from '../worker'
import { newOffer, newCard } from '../shared/offers'
import { offerSchema, type Offer, type CaptureUpload } from '../shared/schema'
import presskitOcr from './fixtures/presskit-ocr.json'
import { PARSER_VERSION } from '../shared/recognition'

const databases: DatabaseSync[] = []
const consentIds = { captures: '11111111-1111-4111-8111-111111111111', observations: '22222222-2222-4222-8222-222222222222' }
const consentToken = 'c'.repeat(64)
afterEach(() => { for (const db of databases.splice(0)) db.close() })
function env(): Env {
  const database = new DatabaseSync(':memory:')
  const migrations = new URL('../migrations/', import.meta.url)
  for (const file of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) database.exec(readFileSync(new URL(file, migrations), 'utf8'))
  databases.push(database)
  for (const scope of ['captures', 'observations'] as const) {
    database.prepare('INSERT INTO data_consents (id, scope, policy_version, consent_text, origin, accepted_at, recorded_at, token_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(consentIds[scope], scope, CONSENT_VERSION, consentText(scope, 'https://collector.test'), 'https://collector.test', '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z', createHash('sha256').update(consentToken).digest('hex'))
  }
  const adapter = { prepare(sql: string) {
    let args: (string | number | null)[] = []
    const query = { bind(...values: (string | number | null)[]) { args = values; return query },
      async run() { const result = database.prepare(sql).run(...args); return { meta: { changes: Number(result.changes) } } },
      async first() { return database.prepare(sql).get(...args) ?? null } }
    return query
  } }
  return { DB: adapter as unknown as D1Database, ASSETS: { fetch: async () => new Response('static') } as unknown as Fetcher, COLLECTOR_INGEST_KEY: 'test-access', COLLECTOR_CAPTURE_KEY: 'capture-access' }
}
function offer(): Offer { return { ...newOffer(), source: 'manual', origin: 'live', reviewed: true, completeness: 'partial', cards: [{ ...newCard(), name: 'Alchemist' }] } }
function post(body: unknown, key = 'test-access') { return new Request('https://collector.test/api/observations', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, 'X-Consent-Id': consentIds.observations, 'X-Consent-Token': consentToken }, body: JSON.stringify(body) }) }
function upload(): CaptureUpload { return { kind: 'fate-collector.upload', schemaVersion: 1, captureId: crypto.randomUUID(), capturedAt: new Date().toISOString(), source: 'windows-helper', helperVersion: '0.1.0', context: { captureMode: 'game' }, image: { width: 3840, height: 2160 }, ocr: { ...presskitOcr, status: 'ok' } } }
function capturePost(body: unknown, key = 'capture-access') { return new Request('https://collector.test/api/captures', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, 'X-Consent-Id': consentIds.captures, 'X-Consent-Token': consentToken }, body: JSON.stringify(body) }) }

test('ingestion is closed when not configured or unauthorized', async () => {
  const bindings = env()
  expect((await worker.fetch(post(offer()), { ...bindings, COLLECTOR_INGEST_KEY: undefined })).status).toBe(503)
  expect((await worker.fetch(post(offer(), 'wrong'), bindings)).status).toBe(401)
})
test('rejects test samples, unreviewed offers and screenshot fields', async () => {
  const bindings = env()
  expect((await worker.fetch(post({ ...offer(), origin: 'test' }), bindings)).status).toBe(422)
  expect((await worker.fetch(post({ ...offer(), reviewed: false }), bindings)).status).toBe(422)
  expect((await worker.fetch(post({ ...offer(), imageDataUrl: 'private screenshot' }), bindings)).status).toBe(400)
})
test('retries are idempotent, conflicting revisions are rejected, corrections are new revisions', async () => {
  const bindings = env(); const sample = offer()
  expect((await worker.fetch(post(sample), bindings)).status).toBe(201)
  const retry = await worker.fetch(post(sample), bindings)
  expect(retry.status).toBe(200)
  expect(await retry.json()).toMatchObject({ status: 'duplicate' })
  expect((await worker.fetch(post({ ...sample, area: 'Different' }), bindings)).status).toBe(409)
  expect((await worker.fetch(post({ ...sample, revision: 2, area: 'Corrected' }), bindings)).status).toBe(201)
  expect(databases[0].prepare('SELECT count(*) AS n FROM observations').get()?.n).toBe(2)
  expect(databases[0].prepare('SELECT count(*) AS n FROM latest_observations').get()?.n).toBe(1)
  expect(databases[0].prepare('SELECT revision FROM latest_observations').get()?.revision).toBe(2)
})
test('enforces body size without trusting Content-Length', async () => {
  const response = await worker.fetch(post({ padding: 'x'.repeat(130 * 1024) }), env())
  expect(response.status).toBe(413)
})
test('unknown API routes return JSON and never the SPA', async () => {
  const bindings = env()
  expect((await worker.fetch(new Request('https://collector.test/api/missing'), bindings)).status).toBe(404)
  expect(await (await worker.fetch(new Request('https://collector.test/'), bindings)).text()).toBe('static')
})

test('status identifies the deployed package without exposing bindings or secrets', async () => {
  const bindings = { ...env(), APP_ENV: 'staging', RELEASE_REVISION: 'a'.repeat(40), RELEASE_ID: 'b'.repeat(64) }
  const response = await worker.fetch(new Request('https://collector.test/api/status'), bindings)
  const status = await response.json()
  expect(status).toMatchObject({ environment: 'staging', revision: bindings.RELEASE_REVISION, releaseId: bindings.RELEASE_ID })
  expect(JSON.stringify(status)).not.toContain('capture-access')
  expect(JSON.stringify(status)).not.toContain('test-access')
  const page = await worker.fetch(new Request('https://collector.test/'), bindings)
  expect(page.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
  expect((await worker.fetch(new Request('https://collector.test/'), env())).headers.has('X-Robots-Tag')).toBe(false)
})

test('capture access is independent and cannot submit reviewed observations', async () => {
  const bindings = env()
  expect((await worker.fetch(capturePost(upload()), { ...bindings, COLLECTOR_CAPTURE_KEY: undefined })).status).toBe(503)
  expect((await worker.fetch(capturePost(upload(), 'test-access'), bindings)).status).toBe(401)
  expect((await worker.fetch(post(offer(), 'capture-access'), bindings)).status).toBe(401)
  expect((await worker.fetch(capturePost(upload()), { ...bindings, COLLECTOR_INGEST_KEY: undefined })).status).toBe(201)
})
test('automatic upload stores raw OCR and unverified candidates without creating reviewed observations', async () => {
  const bindings = env(); const sample = upload()
  const response = await worker.fetch(capturePost(sample), bindings)
  expect(response.status).toBe(201)
  expect(await response.json()).toEqual({ id: sample.captureId, status: 'accepted', reviewed: false })
  const stored = databases[0].prepare('SELECT * FROM capture_uploads').get()!
  expect(JSON.parse(stored.payload_json as string)).toEqual(sample)
  const candidate = offerSchema.parse(JSON.parse(stored.parsed_offer_json as string))
  expect(candidate).toMatchObject({ id: sample.captureId, reviewed: false, completeness: 'unverified', gameVersion: 'unknown' })
  expect(candidate.cards.map(c => c.name)).toEqual(['Torchbearer', 'Tempest', 'Stormcaller', 'Houndmaster'])
  expect(databases[0].prepare('SELECT count(*) AS n FROM observations').get()?.n).toBe(0)
  expect(databases[0].prepare('SELECT reviewed, intake FROM research_observations').get()).toMatchObject({ reviewed: 0, intake: 'automatic' })
})
test('automatic retries deduplicate immutable input and reject conflicting OCR', async () => {
  const bindings = env(); const sample = upload()
  expect((await worker.fetch(capturePost(sample), bindings)).status).toBe(201)
  const original = databases[0].prepare('SELECT parsed_offer_json FROM capture_uploads').get()?.parsed_offer_json
  const retry = await worker.fetch(capturePost(sample), bindings)
  expect(retry.status).toBe(200)
  expect(await retry.json()).toEqual({ id: sample.captureId, status: 'duplicate', reviewed: false })
  expect((await worker.fetch(capturePost({ ...sample, ocr: { ...sample.ocr, text: 'Changed' } }), bindings)).status).toBe(409)
  expect(databases[0].prepare('SELECT count(*) AS n FROM capture_uploads').get()?.n).toBe(1)
  expect(databases[0].prepare('SELECT parsed_offer_json FROM capture_uploads').get()?.parsed_offer_json).toBe(original)
})

test('unread offered names preserve raw OCR without storing collected cards as candidates', async () => {
  const bindings = env(); const sample = upload()
  sample.ocr.lines = sample.ocr.lines.filter(entry => entry.y < 479 || entry.y > 523)
  sample.ocr.text = sample.ocr.lines.map(entry => entry.text).join('\n')
  expect((await worker.fetch(capturePost(sample), bindings)).status).toBe(201)
  const stored = databases[0].prepare('SELECT payload_json, parsed_offer_json, parser_version FROM capture_uploads').get()!
  expect(JSON.parse(stored.payload_json as string)).toEqual(sample)
  expect(JSON.parse(stored.parsed_offer_json as string)).toMatchObject({ cards: [], reviewed: false, completeness: 'unverified' })
  expect(stored.parser_version).toBe(PARSER_VERSION)
})
test('possible repeats remain distinct observations and preserve context through review', async () => {
  const bindings = env()
  const first = upload()
  const session = { id: crypto.randomUUID(), startedAt: first.capturedAt, sequence: 1 }
  first.context.session = session
  const second: CaptureUpload = { ...first, captureId: crypto.randomUUID(), capturedAt: new Date(Date.parse(first.capturedAt) + 500).toISOString(),
    context: { captureMode: 'game', session: { ...session, sequence: 2 }, possibleDuplicate: { ofCaptureId: first.captureId, reason: 'same-ocr-within-15s' } } }
  expect((await worker.fetch(capturePost(first), bindings)).status).toBe(201)
  const receipt = await worker.fetch(capturePost(second), bindings)
  expect(receipt.status).toBe(201)
  expect(await receipt.json()).toEqual({ id: second.captureId, status: 'accepted', reviewed: false })
  const db = databases[0]
  expect(db.prepare('SELECT count(*) AS n FROM research_observations').get()?.n).toBe(2)
  const raw = db.prepare('SELECT payload_json, parsed_offer_json FROM capture_uploads WHERE id = ?').get(second.captureId)!
  expect(JSON.parse(raw.payload_json as string)).toEqual(second)
  const candidate = offerSchema.parse(JSON.parse(raw.parsed_offer_json as string))
  expect(candidate).toMatchObject({ captureContext: second.context, encounterNumber: 1 })
  expect((await worker.fetch(post({ ...candidate, revision: 2, notes: 'Reviewed card correction', reviewed: true, completeness: 'partial' }), bindings)).status).toBe(201)
  expect(db.prepare('SELECT count(*) AS n FROM capture_uploads').get()?.n).toBe(2)
  expect(db.prepare('SELECT count(*) AS n FROM research_observations').get()?.n).toBe(2)
  const corrected = db.prepare('SELECT offer_json, reviewed FROM research_observations WHERE id = ?').get(second.captureId)!
  expect(corrected.reviewed).toBe(1)
  expect(JSON.parse(corrected.offer_json as string)).toMatchObject({ captureContext: second.context, revision: 2, notes: 'Reviewed card correction' })
})
test('rejects screenshots, fixtures, missing provenance and oversized uploads', async () => {
  const bindings = env(); const sample = upload()
  expect((await worker.fetch(capturePost({ ...sample, image: { ...sample.image, dataBase64: 'AAAA' } }), bindings)).status).toBe(400)
  expect((await worker.fetch(capturePost({ ...sample, context: { captureMode: 'fixture' } }), bindings)).status).toBe(422)
  expect((await worker.fetch(capturePost({ ...sample, context: undefined }), bindings)).status).toBe(400)
  expect((await worker.fetch(capturePost({ padding: 'x'.repeat(130 * 1024) }), bindings)).status).toBe(413)
  expect(databases[0].prepare('SELECT count(*) AS n FROM capture_uploads').get()?.n).toBe(0)
})
test('unavailable OCR is retained rather than silently excluding failed recognition', async () => {
  const bindings = env()
  const sample = { ...upload(), ocr: { status: 'unavailable', text: '', lines: [], language: null } }
  expect((await worker.fetch(capturePost(sample), bindings)).status).toBe(201)
  const stored = databases[0].prepare('SELECT payload_json, parsed_offer_json FROM capture_uploads').get()!
  expect(JSON.parse(stored.payload_json as string).ocr.status).toBe('unavailable')
  expect(JSON.parse(stored.parsed_offer_json as string).cards).toEqual([])
})
test('reviewed corrections replace automatic capture in the combined view without deleting raw evidence', async () => {
  const bindings = env(); const sample = upload()
  await worker.fetch(capturePost(sample), bindings)
  const reviewed = { ...offer(), id: sample.captureId, captureId: sample.captureId }
  expect((await worker.fetch(post(reviewed), bindings)).status).toBe(201)
  expect((await worker.fetch(post({ ...reviewed, revision: 2, area: 'Correction' }), bindings)).status).toBe(201)
  expect(databases[0].prepare('SELECT count(*) AS n FROM research_observations').get()?.n).toBe(1)
  expect(databases[0].prepare('SELECT revision, reviewed, intake FROM research_observations').get()).toMatchObject({ revision: 2, reviewed: 1, intake: 'reviewed' })
  expect(databases[0].prepare('SELECT count(*) AS n FROM capture_uploads').get()?.n).toBe(1)
  // A capture reference also suppresses the raw row when a corrected offer has another ID.
  const second = upload(); await worker.fetch(capturePost(second), bindings)
  await worker.fetch(post({ ...offer(), captureId: second.captureId }), bindings)
  expect(databases[0].prepare('SELECT count(*) AS n FROM research_observations').get()?.n).toBe(2)
})
test('database errors are retriable without exposing submitted text', async () => {
  const bindings = env()
  const failed = { ...bindings, DB: { prepare() { throw new Error('private database error') } } as unknown as D1Database }
  const response = await worker.fetch(capturePost(upload()), failed)
  expect(response.status).toBe(503)
  expect(await response.text()).not.toContain('private database error')
})
