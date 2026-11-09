import { json, digest, authorized, boundedText } from './http'
import { handleConsent, uploadConsent, activeConsent, type ConsentRecord } from './consent'
import { CONSENT_VERSION } from '../shared/consent'
import { APP_VERSION } from '../shared/diagnostics'
import { expireDiagnostics, handleDiagnostics } from './diagnostics'
import { captureUploadSchema, offerSchema } from '../shared/schema'
import { newOffer, submissionProblem } from '../shared/offers'
import { extractCards, PARSER_VERSION } from '../shared/recognition'

export interface Env extends Partial<WorkerBindings> { ASSETS: Fetcher; COLLECTOR_INGEST_KEY?: string; COLLECTOR_CAPTURE_KEY?: string }
async function receiveCapture(body: unknown, database: D1Database, consent: ConsentRecord): Promise<Response> {
  const result = captureUploadSchema.safeParse(body)
  if (!result.success) return json({ error: 'Invalid capture upload.', issues: result.error.issues.slice(0, 5).map(i => ({ path: i.path, message: i.message })) }, 400)
  const capture = result.data
  if (capture.context.captureMode !== 'game') return json({ error: 'Fixture captures cannot be uploaded to the research collection.' }, 422)
  if (Date.parse(capture.capturedAt) < Date.parse(consent.accepted_at)) return json({ error: 'Only captures made after this consent can be uploaded.' }, 422)
  // Hash the validated raw input, not parser output (which may change later).
  const payload = JSON.stringify(capture)
  const hash = await digest(payload)
  const candidate = offerSchema.parse({ ...newOffer(), id: capture.captureId, captureId: capture.captureId, captureContext: capture.context,
    source: 'windows-helper', origin: 'live', gameVersion: 'unknown',
    capturedAt: capture.capturedAt, updatedAt: capture.capturedAt,
    cards: extractCards(capture).cards.slice(0, 30), reviewed: false, completeness: 'unverified' })
  try {
    const insert = await database.prepare(`INSERT INTO capture_uploads (id, content_hash, payload_json, parsed_offer_json, parser_version, captured_at, consent_id)
      SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM data_consents WHERE id = ? AND policy_version = ?)
      AND NOT EXISTS (SELECT 1 FROM consent_withdrawals WHERE id = ?) ON CONFLICT(id) DO NOTHING`)
      .bind(capture.captureId, hash, payload, JSON.stringify(candidate), PARSER_VERSION, capture.capturedAt, consent.id, consent.id, CONSENT_VERSION, consent.id).run()
    if (!insert.meta.changes) {
      if (!await activeConsent(database, consent.id)) return json({ error: 'Consent has been withdrawn. Upload stopped.', code: 'consent-required' }, 403)
      const previous = await database.prepare('SELECT content_hash, consent_id FROM capture_uploads WHERE id = ?').bind(capture.captureId).first<{ content_hash: string; consent_id: string }>()
      if (previous?.content_hash !== hash || previous.consent_id !== consent.id) return json({ error: 'This capture ID already exists under different data or consent. Keep the original capture locally.' }, 409)
      return json({ id: capture.captureId, status: 'duplicate', reviewed: false })
    }
    return json({ id: capture.captureId, status: 'accepted', reviewed: false }, 201)
  } catch {
    return json({ error: 'The collection database is unavailable. The helper should keep this capture and retry later.' }, 503)
  }
}

export default {
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    if (!env.DB) throw new Error('Diagnostic cleanup database is unavailable.')
    await expireDiagnostics(env.DB)
  },
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
      return json({ schemaVersion: 1, version: APP_VERSION, diagnosticsEnabled: Boolean(env.DB && env.DIAGNOSTIC_RATE_LIMITER && (env.COLLECTOR_INGEST_KEY || env.COLLECTOR_CAPTURE_KEY)), consentRequired: true, consentPolicyVersion: CONSENT_VERSION, environment: env.APP_ENV || 'local', revision: env.RELEASE_REVISION || 'local', releaseId: env.RELEASE_ID || 'local', ingestionEnabled: Boolean(env.DB && env.COLLECTOR_INGEST_KEY), captureIngestionEnabled: Boolean(env.DB && env.COLLECTOR_CAPTURE_KEY) })
    }
    if (url.pathname === '/api/consents' || /^\/api\/consents\/[^/]+\/withdraw$/.test(url.pathname)) return handleConsent(request, env)
    if (url.pathname === '/api/diagnostics' || /^\/api\/diagnostics\/[^/]+\/withdraw$/.test(url.pathname)) return handleDiagnostics(request, env)
    const isCapture = url.pathname === '/api/captures'
    if (!isCapture && url.pathname !== '/api/observations') return json({ error: 'Not found.' }, 404)
    if (request.method !== 'POST') return json({ error: 'Use POST to submit data.' }, 405)
    const key = isCapture ? env.COLLECTOR_CAPTURE_KEY : env.COLLECTOR_INGEST_KEY
    if (!env.DB || !key) return json({ error: 'Shared collection is not configured. Your local data is unaffected.' }, 503)
    if (!await authorized(request, key)) return json({ error: 'A valid collection access key is required.' }, 401)
    const consent = await uploadConsent(request, env.DB, isCapture ? 'captures' : 'observations')
    if (consent instanceof Response) return consent
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return json({ error: 'Send application/json.' }, 415)
    let body: unknown
    try { body = JSON.parse(await boundedText(request)) } catch (error) {
      return json({ error: error instanceof Error && error.message === 'too-large' ? 'Upload exceeds 128 KiB.' : 'Invalid JSON upload.' }, error instanceof Error && error.message === 'too-large' ? 413 : 400)
    }
    if (isCapture) return receiveCapture(body, env.DB, consent)
    const result = offerSchema.safeParse(body)
    if (!result.success) return json({ error: 'Invalid observation.', issues: result.error.issues.slice(0, 5).map(i => ({ path: i.path, message: i.message })) }, 400)
    const offer = result.data
    const problem = submissionProblem(offer)
    if (problem) return json({ error: problem }, 422)
    const payload = JSON.stringify(offer)
    const hash = await digest(payload)
    try {
      // Atomic first writer wins. Retries do not count a roll twice, even concurrently.
      const insert = await env.DB.prepare(`INSERT INTO observations (id, revision, content_hash, payload_json, game_version, completeness, captured_at, consent_id)
        SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM data_consents WHERE id = ? AND policy_version = ?)
        AND NOT EXISTS (SELECT 1 FROM consent_withdrawals WHERE id = ?)
        AND NOT EXISTS (SELECT 1 FROM observations WHERE id = ? AND (consent_id IS NULL OR consent_id <> ?))
        AND (EXISTS (SELECT 1 FROM observations WHERE id = ? AND lower(json_extract(payload_json, '$.captureId')) = lower(?))
          OR NOT EXISTS (SELECT 1 FROM observations WHERE id <> ? AND ? IS NOT NULL
            AND lower(json_extract(payload_json, '$.captureId')) = lower(?)))
        AND NOT EXISTS (SELECT 1 FROM observations WHERE id = ?
          AND coalesce(lower(json_extract(payload_json, '$.captureId')), '') <> coalesce(lower(?), ''))
        ON CONFLICT(id, revision) DO NOTHING`)
        .bind(offer.id, offer.revision, hash, payload, offer.gameVersion, offer.completeness, offer.capturedAt, consent.id, consent.id, CONSENT_VERSION, consent.id, offer.id, consent.id,
          offer.id, offer.captureId, offer.id, offer.captureId, offer.captureId, offer.id, offer.captureId).run()
      if (!insert.meta.changes) {
        if (!await activeConsent(env.DB, consent.id)) return json({ error: 'Consent has been withdrawn. Sharing stopped.', code: 'consent-required' }, 403)
        const previous = await env.DB.prepare('SELECT content_hash, consent_id FROM observations WHERE id = ? AND revision = ?').bind(offer.id, offer.revision).first<{ content_hash: string; consent_id: string }>()
        if (previous?.content_hash !== hash || previous.consent_id !== consent.id) return json({ error: 'This offer, revision or capture already belongs to different data or consent. Keep the original offer ID and capture reference when correcting it.' }, 409)
        return json({ id: offer.id, revision: offer.revision, status: 'duplicate' })
      }
      return json({ id: offer.id, revision: offer.revision, status: 'accepted' }, 201)
    } catch {
      // Do not log user payloads or authorization headers.
      return json({ error: 'The collection database is unavailable. Keep the offer locally and retry later.' }, 503)
    }
  },
}
