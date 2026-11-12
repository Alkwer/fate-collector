import { z } from 'zod'
import { SYMBOL_REPORT_LIMIT, SYMBOL_RETENTION_MS, symbolConsentText, symbolId, symbolSubmissionSchema, symbolToken, validateSymbolPixels } from '../shared/symbol-reports'
import { authorized, boundedText, digest, json } from './http'

interface Env { DB?: D1Database; COLLECTOR_INGEST_KEY?: string; APP_ENV?: string; DIAGNOSTIC_RATE_LIMITER?: RateLimit }
interface Stored { id: string; token_hash: string; content_hash: string; report_json: string | null; consent_version: string; consent_text: string; accepted_at: string; recorded_at: string; expires_at: string; withdrawn_at: string | null }
const DAILY_LIMIT = 50, MAX_STORED_BYTES = 100 * 1024 * 1024
function limited() {
  const response = json({ error: 'Symbol report limit reached. Your local report is kept; retry later.' }, 429)
  response.headers.set('Retry-After', '3600'); return response
}
export async function expireSymbolReports(db: D1Database, now = new Date().toISOString()) {
  await db.prepare('UPDATE symbol_reports SET report_json = NULL WHERE expires_at <= ? AND report_json IS NOT NULL').bind(now).run()
}
export async function handleSymbolReports(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Use POST. Symbol reports are private.' }, 405)
  if (!env.DB || !env.DIAGNOSTIC_RATE_LIMITER) return json({ error: 'Symbol reporting is unavailable. Keep the images locally.' }, 503)
  const url = new URL(request.url), withdrawal = /^\/api\/symbol-reports\/([^/]+)\/withdraw$/.exec(url.pathname)
  if (!withdrawal && (!env.COLLECTOR_INGEST_KEY || !await authorized(request, env.COLLECTOR_INGEST_KEY))) return json({ error: 'A reviewed-offer collection access key is required.' }, 401)
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return json({ error: 'Send application/json.' }, 415)
  try {
    const source = await digest(`${new Date().toISOString().slice(0, 10)}:${request.headers.get('CF-Connecting-IP') || 'local'}:${env.COLLECTOR_INGEST_KEY || ''}`)
    if (!(await env.DIAGNOSTIC_RATE_LIMITER.limit({ key: `fate-symbols:${env.APP_ENV || 'local'}:${withdrawal ? 'withdraw' : 'send'}:${source}` })).success) return limited()
  } catch { return json({ error: 'Symbol reporting protection is unavailable.' }, 503) }
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
      if (!known && (!env.COLLECTOR_INGEST_KEY || !await authorized(request, env.COLLECTOR_INGEST_KEY))) return json({ error: 'Enter the collection key to cancel an upload that has not reached the server yet.' }, 401)
      await env.DB.prepare(`INSERT INTO symbol_withdrawals (id, token_hash, requested_at, withdrawn_at)
        SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM symbol_reports WHERE id = ? AND token_hash <> ?)
        AND NOT EXISTS (SELECT 1 FROM symbol_withdrawals WHERE id = ? AND token_hash <> ?)
        AND (EXISTS (SELECT 1 FROM symbol_reports WHERE id = ?) OR EXISTS (SELECT 1 FROM symbol_withdrawals WHERE id = ?)
          OR (SELECT count(*) FROM symbol_withdrawals WHERE withdrawn_at >= ? AND unknown_report = 1) < ?)
        ON CONFLICT(id) DO NOTHING`).bind(id.data, hash, input.data.withdrawnAt, now, id.data, hash, id.data, hash, id.data, id.data, day, DAILY_LIMIT).run()
      const saved = await env.DB.prepare('SELECT withdrawn_at FROM symbol_withdrawals WHERE id = ? AND token_hash = ?').bind(id.data, hash).first<{ withdrawn_at: string }>()
      if (!saved) {
        const exists = await env.DB.prepare('SELECT id FROM symbol_reports WHERE id = ? UNION ALL SELECT id FROM symbol_withdrawals WHERE id = ? LIMIT 1').bind(id.data, id.data).first()
        return exists ? json({ error: 'The withdrawal credential does not match.' }, 401) : limited()
      }
      return json({ id: id.data, status: 'withdrawn', withdrawnAt: saved.withdrawn_at })
    }
    const parsed = symbolSubmissionSchema.safeParse(body)
    if (!parsed.success) return json({ error: 'Check the symbol, tooltip, reward details and game version.' }, 400)
    const { report, token, consent } = parsed.data
    if (consent.text !== symbolConsentText(url.origin)) return json({ error: 'Read and accept the current image-sharing consent.' }, 409)
    if (Date.parse(consent.acceptedAt) > Date.now() + 300000 || Date.parse(report.createdAt) > Date.now() + 300000) return json({ error: 'Check your device clock.' }, 400)
    if (!await validateSymbolPixels(report)) return json({ error: 'An image cannot be decoded. Choose a valid symbol and tooltip image.' }, 400)
    const payload = JSON.stringify(report), bytes = new TextEncoder().encode(payload).length
    const hash = await digest(JSON.stringify({ report, consent })), tokenHash = await digest(token)
    await expireSymbolReports(env.DB, now)
    await env.DB.prepare(`INSERT INTO symbol_reports (id, token_hash, content_hash, report_json, consent_version, consent_text, accepted_at, recorded_at, expires_at, payload_bytes)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM symbol_withdrawals WHERE id = ?)
      AND (EXISTS (SELECT 1 FROM symbol_reports WHERE id = ?) OR ((SELECT count(*) FROM symbol_reports WHERE recorded_at >= ?) < ?
        AND (SELECT coalesce(sum(payload_bytes), 0) FROM symbol_reports WHERE report_json IS NOT NULL) + ? <= ?))
      ON CONFLICT(id) DO NOTHING`).bind(report.id, tokenHash, hash, payload, consent.version, consent.text, consent.acceptedAt, now, new Date(Date.parse(now) + SYMBOL_RETENTION_MS).toISOString(), bytes, report.id, report.id, day, DAILY_LIMIT, bytes, MAX_STORED_BYTES).run()
    const saved = await env.DB.prepare('SELECT * FROM symbol_reports WHERE id = ?').bind(report.id).first<Stored>()
    if (!saved) {
      const removed = await env.DB.prepare('SELECT id FROM symbol_withdrawals WHERE id = ?').bind(report.id).first()
      return removed ? json({ error: 'This report was withdrawn and cannot be sent again.' }, 410) : limited()
    }
    if (saved.token_hash !== tokenHash || saved.content_hash !== hash) return json({ error: 'This report ID belongs to another submission.' }, 409)
    if (saved.withdrawn_at || !saved.report_json) return json({ error: 'This report was withdrawn or expired.' }, 410)
    return json({ id: saved.id, status: 'received', receivedAt: saved.recorded_at, expiresAt: saved.expires_at,
      consent: { version: saved.consent_version, text: saved.consent_text, acceptedAt: saved.accepted_at, recordedAt: saved.recorded_at } }, 200)
  } catch { return json({ error: 'The collection is unavailable. Your local report is kept; retry later.' }, 503) }
}
