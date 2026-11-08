import { MAX_API_BYTES, captureUploadSchema, offerSchema } from '../shared/schema'
import { newOffer, submissionProblem } from '../shared/offers'
import { extractCards, PARSER_VERSION } from '../shared/recognition'

export interface Env extends Partial<WorkerBindings> { ASSETS: Fetcher; COLLECTOR_INGEST_KEY?: string; COLLECTOR_CAPTURE_KEY?: string }
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  } })
}
async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('')
}
async function authorized(request: Request, secret: string): Promise<boolean> {
  const supplied = request.headers.get('authorization') || ''
  if (supplied.length > 1024 || !supplied.startsWith('Bearer ')) return false
  const [a, b] = await Promise.all([digest(supplied.slice(7)), digest(secret)])
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
async function boundedText(request: Request): Promise<string> {
  const reader = request.body?.getReader()
  if (!reader) throw new Error('empty')
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_API_BYTES) { await reader.cancel(); throw new Error('too-large') }
    chunks.push(value)
  }
  const all = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength }
  return new TextDecoder('utf-8', { fatal: true }).decode(all)
}

async function receiveCapture(body: unknown, database: D1Database): Promise<Response> {
  const result = captureUploadSchema.safeParse(body)
  if (!result.success) return json({ error: 'Invalid capture upload.', issues: result.error.issues.slice(0, 5).map(i => ({ path: i.path, message: i.message })) }, 400)
  const capture = result.data
  if (capture.context.captureMode !== 'game') return json({ error: 'Fixture captures cannot be uploaded to the research collection.' }, 422)
  // Hash the validated raw input, not parser output (which may change later).
  const payload = JSON.stringify(capture)
  const hash = await digest(payload)
  const candidate = offerSchema.parse({ ...newOffer(), id: capture.captureId, captureId: capture.captureId, captureContext: capture.context,
    source: 'windows-helper', origin: 'live', gameVersion: 'unknown',
    capturedAt: capture.capturedAt, updatedAt: capture.capturedAt,
    cards: extractCards(capture).cards.slice(0, 30), reviewed: false, completeness: 'unverified' })
  try {
    const insert = await database.prepare('INSERT INTO capture_uploads (id, content_hash, payload_json, parsed_offer_json, parser_version, captured_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING')
      .bind(capture.captureId, hash, payload, JSON.stringify(candidate), PARSER_VERSION, capture.capturedAt).run()
    if (!insert.meta.changes) {
      const previous = await database.prepare('SELECT content_hash FROM capture_uploads WHERE id = ?').bind(capture.captureId).first<{ content_hash: string }>()
      if (previous?.content_hash !== hash) return json({ error: 'This capture ID already exists with different data. Keep the original capture and review it separately.' }, 409)
      return json({ id: capture.captureId, status: 'duplicate', reviewed: false })
    }
    return json({ id: capture.captureId, status: 'accepted', reviewed: false }, 201)
  } catch {
    return json({ error: 'The collection database is unavailable. The helper should keep this capture and retry later.' }, 503)
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/')) {
      const response = await env.ASSETS.fetch(request)
      if (env.APP_ENV !== 'staging') return response
      const headers = new Headers(response.headers)
      headers.set('X-Robots-Tag', 'noindex, nofollow')
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
    }
    if (url.pathname === '/api/status' && request.method === 'GET') {
      return json({ schemaVersion: 1, version: '0.1.0', environment: env.APP_ENV || 'local', revision: env.RELEASE_REVISION || 'local', releaseId: env.RELEASE_ID || 'local', ingestionEnabled: Boolean(env.DB && env.COLLECTOR_INGEST_KEY), captureIngestionEnabled: Boolean(env.DB && env.COLLECTOR_CAPTURE_KEY) })
    }
    const isCapture = url.pathname === '/api/captures'
    if (!isCapture && url.pathname !== '/api/observations') return json({ error: 'Not found.' }, 404)
    if (request.method !== 'POST') return json({ error: 'Use POST to submit data.' }, 405)
    const key = isCapture ? env.COLLECTOR_CAPTURE_KEY : env.COLLECTOR_INGEST_KEY
    if (!env.DB || !key) return json({ error: 'Shared collection is not configured. Your local data is unaffected.' }, 503)
    if (!await authorized(request, key)) return json({ error: 'A valid collection access key is required.' }, 401)
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return json({ error: 'Send application/json.' }, 415)
    let body: unknown
    try { body = JSON.parse(await boundedText(request)) } catch (error) {
      return json({ error: error instanceof Error && error.message === 'too-large' ? 'Upload exceeds 128 KiB.' : 'Invalid JSON upload.' }, error instanceof Error && error.message === 'too-large' ? 413 : 400)
    }
    if (isCapture) return receiveCapture(body, env.DB)
    const result = offerSchema.safeParse(body)
    if (!result.success) return json({ error: 'Invalid observation.', issues: result.error.issues.slice(0, 5).map(i => ({ path: i.path, message: i.message })) }, 400)
    const offer = result.data
    const problem = submissionProblem(offer)
    if (problem) return json({ error: problem }, 422)
    const payload = JSON.stringify(offer)
    const hash = await digest(payload)
    try {
      // Atomic first writer wins. Retries do not count a roll twice, even concurrently.
      const insert = await env.DB.prepare('INSERT INTO observations (id, revision, content_hash, payload_json, game_version, completeness, captured_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id, revision) DO NOTHING')
        .bind(offer.id, offer.revision, hash, payload, offer.gameVersion, offer.completeness, offer.capturedAt).run()
      if (!insert.meta.changes) {
        const previous = await env.DB.prepare('SELECT content_hash FROM observations WHERE id = ? AND revision = ?').bind(offer.id, offer.revision).first<{ content_hash: string }>()
        if (previous?.content_hash !== hash) return json({ error: 'This revision already exists with different data. Save a new revision before retrying.' }, 409)
        return json({ id: offer.id, revision: offer.revision, status: 'duplicate' })
      }
      return json({ id: offer.id, revision: offer.revision, status: 'accepted' }, 201)
    } catch {
      // Do not log user payloads or authorization headers.
      return json({ error: 'The collection database is unavailable. Keep the offer locally and retry later.' }, 503)
    }
  },
}
