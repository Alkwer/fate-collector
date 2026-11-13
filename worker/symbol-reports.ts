import { z } from '../shared/validation'
import { SYMBOL_REPORT_LIMIT, SYMBOL_RETENTION_MS, symbolConsentText, symbolId, symbolSubmissionSchema, symbolToken, validateSymbolPixels } from '../shared/symbol-reports'
import { boundedText, digest, json } from './http'
import type { ReportFailure } from './observability'
import { symbolReportingEnabled, verifySymbolRequest, type SymbolVerificationEnv } from './symbol-verification'

type Env = SymbolVerificationEnv
interface Stored { id: string; token_hash: string; content_hash: string; report_json: string | null; consent_version: string; consent_text: string; accepted_at: string; recorded_at: string; expires_at: string; withdrawn_at: string | null }
const DAILY_LIMIT = 200, SOURCE_DAILY_LIMIT = 5, MAX_STORED_BYTES = 100 * 1024 * 1024
function limited() {
  const response = json({ error: 'Symbol report limit reached. Your local report is kept; retry later.' }, 429)
  response.headers.set('Retry-After', '3600'); return response
}
export async function expireSymbolReports(db: D1Database, now = new Date().toISOString()) {
  await db.prepare('UPDATE symbol_reports SET report_json = NULL WHERE expires_at <= ? AND report_json IS NOT NULL').bind(now).run()
  await db.prepare('UPDATE symbol_reports SET source_hash = NULL WHERE recorded_at < ? AND source_hash IS NOT NULL').bind(now.slice(0, 10) + 'T00:00:00.000Z').run()
  await db.prepare('UPDATE symbol_withdrawals SET source_hash = NULL WHERE withdrawn_at < ? AND source_hash IS NOT NULL').bind(now.slice(0, 10) + 'T00:00:00.000Z').run()
  await db.prepare('DELETE FROM symbol_challenges WHERE expires_at <= ?').bind(now).run()
}
export async function handleSymbolReports(request: Request, env: Env, fail: ReportFailure): Promise<Response> {
  const url = new URL(request.url)
  if (url.pathname === '/api/symbol-reports/config') {
    if (request.method !== 'GET') return json({ error: 'Use GET for symbol report configuration.' }, 405)
    const enabled = symbolReportingEnabled(env)
    return json({ enabled, sitekey: enabled ? env.TURNSTILE_SITEKEY : null })
  }
  if (request.method !== 'POST') return json({ error: 'Use POST. Symbol reports are private.' }, 405)
  if (!env.DB || !env.DIAGNOSTIC_RATE_LIMITER) return fail('symbols_configuration', 'Symbol reporting is unavailable. Keep the images locally.')
  const withdrawal = /^\/api\/symbol-reports\/([^/]+)\/withdraw$/.exec(url.pathname)
  const review = /^\/api\/symbol-reports\/([^/]+)\/review-status$/.exec(url.pathname)
  if (request.headers.get('Origin') !== url.origin) return json({ error: 'Submit symbol reports from this website.' }, 403)
  if (!withdrawal && !review && !symbolReportingEnabled(env)) return fail('symbols_siteverify_configuration', 'Symbol reporting verification is unavailable. Your local report is kept.')
  if (!review && request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return json({ error: 'Send application/json.' }, 415)
  let source: string
  try {
    const ip = request.headers.get('CF-Connecting-IP')
    if (!ip && env.APP_ENV !== 'local') return fail('symbols_configuration', 'Symbol reporting protection is unavailable.')
    source = await digest(`${new Date().toISOString().slice(0, 10)}:${ip || 'local'}:${env.TURNSTILE_SECRET || ''}`)
    const operation = review ? 'review-status' : withdrawal ? 'withdraw' : 'send'
    if (!(await env.DIAGNOSTIC_RATE_LIMITER.limit({ key: `fate-symbols:${env.APP_ENV || 'local'}:${operation}:${source}` })).success) return limited()
  } catch { return fail('symbols_rate_limiter', 'Symbol reporting protection is unavailable.') }
  if (review) {
    const id = symbolId.safeParse(review[1])
    const token = symbolToken.safeParse(request.headers.get('X-Symbol-Token'))
    const unauthorized = () => json({ error: 'The report credential does not match.' }, 401)
    if (!id.success || !token.success) return unauthorized()
    try {
      const now = new Date().toISOString()
      const tokenHash = await digest(token.data)
      const row = await env.DB.prepare(`SELECT CASE
          WHEN r.withdrawn_at IS NOT NULL OR r.expires_at <= ? OR r.report_json IS NULL THEN 'inactive'
          WHEN v.status = 'pending' AND v.claim_until > ? THEN 'in-review'
          ELSE coalesce(v.status, 'pending') END AS status
        FROM symbol_reports r LEFT JOIN symbol_report_reviews v ON v.report_id = r.id
        WHERE r.id = ? AND r.token_hash = ?
        UNION ALL SELECT 'inactive' FROM symbol_withdrawals WHERE id = ? AND token_hash = ?
        LIMIT 1`).bind(now, now, id.data, tokenHash, id.data, tokenHash).first<{ status: string }>()
      if (!row) return unauthorized()
      if (row.status === 'inactive') return json({ error: 'This report was withdrawn or expired.' }, 410)
      return json({ id: id.data, status: row.status })
    } catch { return fail('symbols_d1', 'Review status is unavailable. Try again later.') }
  }
  let body: unknown
  try { body = JSON.parse(await boundedText(request, withdrawal ? 4096 : SYMBOL_REPORT_LIMIT)) }
  catch (error) { return json({ error: 'Invalid or oversized symbol report.' }, error instanceof Error && error.message === 'too-large' ? 413 : 400) }
  try {
    const now = new Date().toISOString(), day = now.slice(0, 10) + 'T00:00:00.000Z'
    if (withdrawal) {
      const id = symbolId.safeParse(withdrawal[1]), token = symbolToken.safeParse(request.headers.get('X-Symbol-Token'))
      const input = z.object({ withdrawnAt: z.string().datetime({ offset: true }) }).strict().safeParse(body)
      if (!id.success || !token.success || !input.success) return json({ error: 'Invalid withdrawal.' }, 400)
      const hash = await digest(token.data)
      const known = await env.DB.prepare('SELECT id FROM symbol_reports WHERE id = ? UNION ALL SELECT id FROM symbol_withdrawals WHERE id = ? LIMIT 1').bind(id.data, id.data).first()
      if (!known) {
        const rejected = await verifySymbolRequest(request, env, 'symbol-withdraw', id.data, fail)
        if (rejected) return rejected
      }
      await env.DB.prepare(`INSERT INTO symbol_withdrawals (id, token_hash, requested_at, withdrawn_at, source_hash)
        SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM symbol_reports WHERE id = ? AND token_hash <> ?)
        AND NOT EXISTS (SELECT 1 FROM symbol_withdrawals WHERE id = ? AND token_hash <> ?)
        AND (EXISTS (SELECT 1 FROM symbol_reports WHERE id = ?) OR EXISTS (SELECT 1 FROM symbol_withdrawals WHERE id = ?)
          OR ((SELECT count(*) FROM symbol_withdrawals WHERE withdrawn_at >= ? AND unknown_report = 1) < ?
            AND (SELECT count(*) FROM symbol_withdrawals WHERE source_hash = ? AND withdrawn_at >= ? AND unknown_report = 1) < ?))
        ON CONFLICT(id) DO NOTHING`).bind(id.data, hash, input.data.withdrawnAt, now, known ? null : source, id.data, hash, id.data, hash, id.data, id.data, day, DAILY_LIMIT, source, day, SOURCE_DAILY_LIMIT).run()
      const saved = await env.DB.prepare('SELECT withdrawn_at FROM symbol_withdrawals WHERE id = ? AND token_hash = ?').bind(id.data, hash).first<{ withdrawn_at: string }>()
      if (!saved) {
        const exists = await env.DB.prepare('SELECT id FROM symbol_reports WHERE id = ? UNION ALL SELECT id FROM symbol_withdrawals WHERE id = ? LIMIT 1').bind(id.data, id.data).first()
        return exists ? json({ error: 'The withdrawal credential does not match.' }, 401) : limited()
      }
      return json({ id: id.data, status: 'withdrawn', withdrawnAt: saved.withdrawn_at })
    }
    const identity = z.object({ report: z.object({ id: symbolId }) }).safeParse(body)
    if (!identity.success) return json({ error: 'Invalid symbol report.' }, 400)
    const rejected = await verifySymbolRequest(request, env, 'symbol-report', identity.data.report.id, fail)
    if (rejected) return rejected
    const parsed = symbolSubmissionSchema.safeParse(body)
    if (!parsed.success) return json({ error: 'Check the symbol, tooltip, reward details and game version.' }, 400)
    const { report, token, consent } = parsed.data
    if (consent.text !== symbolConsentText(url.origin)) return json({ error: 'Read and accept the current image-sharing consent.' }, 409)
    if (Date.parse(consent.acceptedAt) > Date.now() + 300000 || Date.parse(report.createdAt) > Date.now() + 300000) return json({ error: 'Check your device clock.' }, 400)
    if (!await validateSymbolPixels(report)) return json({ error: 'An image cannot be decoded. Choose a valid symbol and tooltip image.' }, 400)
    const payload = JSON.stringify(report), bytes = new TextEncoder().encode(payload).length
    const hash = await digest(JSON.stringify({ report, consent })), tokenHash = await digest(token)
    await expireSymbolReports(env.DB, now)
    await env.DB.prepare(`INSERT INTO symbol_reports (id, token_hash, content_hash, report_json, consent_version, consent_text, accepted_at, recorded_at, expires_at, payload_bytes, source_hash)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM symbol_withdrawals WHERE id = ?)
      AND (EXISTS (SELECT 1 FROM symbol_reports WHERE id = ?) OR ((SELECT count(*) FROM symbol_reports WHERE recorded_at >= ?) < ?
        AND (SELECT count(*) FROM symbol_reports WHERE source_hash = ? AND recorded_at >= ?) < ?
        AND (SELECT coalesce(sum(payload_bytes), 0) FROM symbol_reports WHERE report_json IS NOT NULL) + ? <= ?))
      ON CONFLICT(id) DO NOTHING`).bind(report.id, tokenHash, hash, payload, consent.version, consent.text, consent.acceptedAt, now, new Date(Date.parse(now) + SYMBOL_RETENTION_MS).toISOString(), bytes, source, report.id, report.id, day, DAILY_LIMIT, source, day, SOURCE_DAILY_LIMIT, bytes, MAX_STORED_BYTES).run()
    const saved = await env.DB.prepare('SELECT * FROM symbol_reports WHERE id = ?').bind(report.id).first<Stored>()
    if (!saved) {
      const removed = await env.DB.prepare('SELECT id FROM symbol_withdrawals WHERE id = ?').bind(report.id).first()
      return removed ? json({ error: 'This report was withdrawn and cannot be sent again.' }, 410) : limited()
    }
    if (saved.token_hash !== tokenHash || saved.content_hash !== hash) return json({ error: 'This report ID belongs to another submission.' }, 409)
    if (saved.withdrawn_at || !saved.report_json) return json({ error: 'This report was withdrawn or expired.' }, 410)
    return json({ id: saved.id, status: 'received', receivedAt: saved.recorded_at, expiresAt: saved.expires_at,
      consent: { version: saved.consent_version, text: saved.consent_text, acceptedAt: saved.accepted_at, recordedAt: saved.recorded_at } }, 200)
  } catch { return fail('symbols_d1', 'The collection is unavailable. Your local report is kept; retry later.') }
}
