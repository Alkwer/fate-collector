import { z } from '../shared/validation'
import { CONSENT_VERSION, consentGrantSchema, consentText, type ConsentScope } from '../shared/consent'
import { authorized, boundedText, digest, json } from './http'
import type { ReportFailure } from './observability'

interface ConsentEnv { DB?: D1Database; COLLECTOR_CAPTURE_KEY?: string; COLLECTOR_INGEST_KEY?: string; CONSENT_WITHDRAWAL_RATE_LIMITER?: RateLimit; APP_ENV?: string }
export interface ConsentRecord {
  id: string; scope: ConsentScope; policy_version: string; consent_text: string; origin: string
  accepted_at: string; recorded_at: string; token_hash: string
}
const withdrawalSchema = z.object({ withdrawnAt: z.string().datetime({ offset: true }) }).strict()
const tokenPattern = /^[a-f0-9]{64}$/
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const DAILY_UNKNOWN_WITHDRAWAL_LIMIT = 100
const unavailable = 'Consent service is unavailable. No new data can be shared.'
const revoked = () => json({ error: 'Consent is missing, withdrawn or outdated. Review the sharing consent before sending data.', code: 'consent-required' }, 403)

export async function activeConsent(database: D1Database, id: string): Promise<boolean> {
  return Boolean(await database.prepare('SELECT id FROM data_consents WHERE lower(id) = lower(?) AND policy_version = ? AND NOT EXISTS (SELECT 1 FROM consent_withdrawals WHERE lower(id) = lower(data_consents.id))').bind(id, CONSENT_VERSION).first())
}
export async function uploadConsent(request: Request, database: D1Database, scope: ConsentScope, fail: ReportFailure): Promise<ConsentRecord | Response> {
  const id = (request.headers.get('X-Consent-Id') || '').toLowerCase()
  const token = request.headers.get('X-Consent-Token') || ''
  if (!id || !token) return json({ error: 'Explicit sharing consent is required before sending data.', code: 'consent-required' }, 428)
  if (!idPattern.test(id) || !tokenPattern.test(token)) return revoked()
  try {
    const record = await database.prepare('SELECT * FROM data_consents WHERE lower(id) = lower(?) AND token_hash = ? AND scope = ? AND origin = ? AND policy_version = ? AND NOT EXISTS (SELECT 1 FROM consent_withdrawals WHERE lower(id) = lower(data_consents.id))')
      .bind(id, await digest(token), scope, new URL(request.url).origin, CONSENT_VERSION).first<ConsentRecord>()
    return record || revoked()
  } catch { return fail('consent_d1', unavailable) }
}

export async function handleConsent(request: Request, env: ConsentEnv, fail: ReportFailure): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Use POST for consent changes.' }, 405)
  if (!env.DB) return fail('consent_configuration', unavailable)
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return json({ error: 'Send application/json.' }, 415)
  const url = new URL(request.url)
  const withdrawal = /^\/api\/consents\/([^/]+)\/withdraw$/.exec(url.pathname)
  if (withdrawal) {
    if (!env.CONSENT_WITHDRAWAL_RATE_LIMITER) return fail('consent_configuration', unavailable)
    try {
      const source = request.headers.get('CF-Connecting-IP') || 'local'
      const key = await digest(`${new Date().toISOString().slice(0, 10)}:${source}:${env.COLLECTOR_CAPTURE_KEY || env.COLLECTOR_INGEST_KEY || ''}`)
      if (!(await env.CONSENT_WITHDRAWAL_RATE_LIMITER.limit({ key: `fate-consent-withdrawal:${env.APP_ENV || 'local'}:${key}` })).success) {
        const response = json({ error: 'Too many consent requests. Sharing remains off locally; deletion will retry later.' }, 429)
        response.headers.set('Retry-After', '60')
        return response
      }
    } catch { return fail('consent_rate_limiter', unavailable) }
  }
  let body: unknown
  try { body = JSON.parse(await boundedText(request)) } catch { return json({ error: 'Invalid consent request.' }, 400) }
  try {
    if (withdrawal) {
      const id = withdrawal[1].toLowerCase()
      const token = request.headers.get('X-Consent-Token') || ''
      const parsed = withdrawalSchema.safeParse(body)
      if (!idPattern.test(id) || !tokenPattern.test(token) || !parsed.success) return json({ error: 'Invalid withdrawal request.' }, 400)
      const tokenHash = await digest(token)
      const now = new Date().toISOString()
      const dayStart = now.slice(0, 10) + 'T00:00:00.000Z'
      // A tombstone also covers a grant whose acknowledgement was lost or which
      // arrives after withdrawal. A different token cannot revoke an existing ID.
      await env.DB.prepare(`INSERT INTO consent_withdrawals (id, token_hash, requested_at, withdrawn_at)
        SELECT ?, ?, ?, ?
        WHERE NOT EXISTS (SELECT 1 FROM data_consents WHERE lower(id) = lower(?) AND token_hash <> ?)
          AND NOT EXISTS (SELECT 1 FROM consent_withdrawals WHERE lower(id) = lower(?) AND token_hash <> ?)
          AND (EXISTS (SELECT 1 FROM data_consents WHERE lower(id) = lower(?)) OR EXISTS (SELECT 1 FROM consent_withdrawals WHERE lower(id) = lower(?))
            OR (SELECT count(*) FROM consent_withdrawals WHERE withdrawn_at >= ?
              AND NOT EXISTS (SELECT 1 FROM data_consents WHERE lower(id) = lower(consent_withdrawals.id))) < ?)
        AND NOT EXISTS (SELECT 1 FROM consent_withdrawals WHERE lower(id) = lower(?))
        ON CONFLICT(id) DO NOTHING`).bind(id, tokenHash, parsed.data.withdrawnAt, now, id, tokenHash, id, tokenHash, id, id, dayStart, DAILY_UNKNOWN_WITHDRAWAL_LIMIT, id).run()
      const saved = await env.DB.prepare('SELECT withdrawn_at FROM consent_withdrawals WHERE lower(id) = lower(?) AND token_hash = ?').bind(id, tokenHash).first<{ withdrawn_at: string }>()
      if (!saved) {
        const existing = await env.DB.prepare('SELECT id FROM data_consents WHERE lower(id) = lower(?) UNION ALL SELECT id FROM consent_withdrawals WHERE lower(id) = lower(?) LIMIT 1').bind(id, id).first()
        if (existing) return json({ error: 'The consent credential does not match.' }, 401)
        const response = json({ error: 'Too many unknown consent withdrawals. Sharing remains off locally; deletion will retry later.' }, 429)
        response.headers.set('Retry-After', String(Math.max(1, Math.ceil((Date.parse(dayStart) + 86400000 - Date.parse(now)) / 1000))))
        return response
      }
      return json({ id, status: 'withdrawn', withdrawnAt: saved.withdrawn_at })
    }
    if (url.pathname !== '/api/consents') return json({ error: 'Not found.' }, 404)
    const parsed = consentGrantSchema.safeParse(body)
    if (!parsed.success) return json({ error: 'Invalid consent record.' }, 400)
    const grant = parsed.data
    const key = grant.scope === 'captures' ? env.COLLECTOR_CAPTURE_KEY : env.COLLECTOR_INGEST_KEY
    if (!key) return fail('consent_configuration', unavailable)
    if (!await authorized(request, key)) return json({ error: 'A valid collection access key is required.' }, 401)
    if (grant.policyVersion !== CONSENT_VERSION || grant.text !== consentText(grant.scope, url.origin)) return json({ error: 'The consent information has changed. Read and accept the current version.', code: 'consent-outdated' }, 409)
    if (Date.parse(grant.acceptedAt) > Date.now() + 300_000) return json({ error: 'The consent date is in the future. Check the device clock.' }, 400)
    const tokenHash = await digest(grant.token)
    const inserted = await env.DB.prepare(`INSERT INTO data_consents (id, scope, policy_version, consent_text, origin, accepted_at, recorded_at, token_hash)
      SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM consent_withdrawals WHERE lower(id) = lower(?))
      AND NOT EXISTS (SELECT 1 FROM data_consents WHERE lower(id) = lower(?))
      ON CONFLICT(id) DO NOTHING`).bind(grant.id, grant.scope, grant.policyVersion, grant.text, url.origin, grant.acceptedAt, new Date().toISOString(), tokenHash, grant.id, grant.id).run()
    if (!await activeConsent(env.DB, grant.id)) return revoked()
    const saved = await env.DB.prepare('SELECT * FROM data_consents WHERE lower(id) = lower(?)').bind(grant.id).first<ConsentRecord>()
    if (!saved || saved.token_hash !== tokenHash || saved.scope !== grant.scope || saved.accepted_at !== grant.acceptedAt || saved.consent_text !== grant.text || saved.origin !== url.origin) return json({ error: 'This consent ID already belongs to another record.' }, 409)
    return json({ id: saved.id.toLowerCase(), scope: saved.scope, policyVersion: saved.policy_version, text: saved.consent_text, acceptedAt: saved.accepted_at, recordedAt: saved.recorded_at, withdrawnAt: null }, inserted.meta.changes ? 201 : 200)
  } catch { return fail('consent_d1', unavailable) }
}
