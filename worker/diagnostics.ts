import { z } from '../shared/validation'
import { DIAGNOSTIC_LIMIT, DIAGNOSTIC_VERSION, RETENTION_MS, diagnosticId, diagnosticSubmissionSchema, diagnosticText, diagnosticToken } from '../shared/diagnostics'
import { authorized, boundedText, digest, json } from './http'
import type { ReportFailure } from './observability'

interface Env { DB?: D1Database; COLLECTOR_CAPTURE_KEY?: string; COLLECTOR_INGEST_KEY?: string; APP_ENV?: string; DIAGNOSTIC_RATE_LIMITER?: RateLimit }
interface StoredReport { id: string; token_hash: string; content_hash: string; report_json: string | null; consent_version: string; consent_text: string; accepted_at: string; recorded_at: string; expires_at: string; withdrawn_at: string | null }
const DAILY_REPORT_LIMIT = 100
const DAILY_UNKNOWN_WITHDRAWAL_LIMIT = 100
function limited(seconds: number): Response {
  const response = json({ error: 'Too many diagnostic requests. Keep the report locally and retry later.', retryAfterSeconds: seconds }, 429)
  response.headers.set('Retry-After', String(seconds))
  return response
}
function dayWindow(now: string) {
  const start = now.slice(0, 10) + 'T00:00:00.000Z'
  return { start, retry: Math.max(1, Math.ceil((Date.parse(start) + 86400000 - Date.parse(now)) / 1000)) }
}

export async function expireDiagnostics(database: D1Database, now = new Date().toISOString()) {
  await database.prepare('UPDATE diagnostic_reports SET report_json = NULL WHERE expires_at <= ? AND report_json IS NOT NULL').bind(now).run()
}
export async function handleDiagnostics(request: Request, env: Env, fail: ReportFailure): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Use POST. Diagnostic reports are private.' }, 405)
  if (!env.DB) return fail('diagnostics_configuration', 'Diagnostics are unavailable. Keep the report locally.')
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return json({ error: 'Send application/json.' }, 415)
  const url = new URL(request.url)
  const withdrawal = /^\/api\/diagnostics\/([^/]+)\/withdraw$/.exec(url.pathname)
  // Cloudflare supplies this header. Neither the address nor its short-lived
  // keyed digest enters a report, D1 row, response or application log.
  if (!env.DIAGNOSTIC_RATE_LIMITER) return fail('diagnostics_configuration', 'Diagnostic protection is unavailable. Keep the report locally.')
  try {
    const source = request.headers.get('CF-Connecting-IP') || 'local'
    const key = await digest(`${new Date().toISOString().slice(0, 10)}:${source}:${env.COLLECTOR_CAPTURE_KEY || env.COLLECTOR_INGEST_KEY || ''}`)
    if (!(await env.DIAGNOSTIC_RATE_LIMITER.limit({ key: `fate-diagnostics:${env.APP_ENV || 'local'}:${withdrawal ? 'delete' : 'send'}:${key}` })).success) return limited(60)
  } catch { return fail('diagnostics_rate_limiter', 'Diagnostic protection is unavailable. Keep the report locally.') }
  if (!withdrawal) {
    const keys = [env.COLLECTOR_CAPTURE_KEY, env.COLLECTOR_INGEST_KEY].filter((key): key is string => !!key)
    if (!(await Promise.all(keys.map(key => authorized(request, key)))).some(Boolean)) return json({ error: 'A collection access key is required.' }, 401)
  }
  let body: unknown
  try {
    const text = await boundedText(request)
    if (new TextEncoder().encode(text).length > DIAGNOSTIC_LIMIT) return json({ error: 'Diagnostic request exceeds 64 KiB.' }, 413)
    body = JSON.parse(text)
  } catch (error) { return json({ error: 'Invalid diagnostic request.' }, error instanceof Error && error.message === 'too-large' ? 413 : 400) }
  try {
    const now = new Date().toISOString()
    const day = dayWindow(now)
    if (withdrawal) {
      const id = diagnosticId.safeParse(withdrawal[1])
      const token = diagnosticToken.safeParse(request.headers.get('X-Diagnostic-Token'))
      const input = z.object({ withdrawnAt: z.string().datetime({ offset: true }) }).strict().safeParse(body)
      if (!id.success || !token.success || !input.success) return json({ error: 'Invalid withdrawal request.' }, 400)
      const hash = await digest(token.data)
      await env.DB.prepare(`INSERT INTO diagnostic_withdrawals (id, token_hash, requested_at, withdrawn_at)
        SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM diagnostic_reports WHERE id = ? AND token_hash <> ?)
        AND NOT EXISTS (SELECT 1 FROM diagnostic_withdrawals WHERE id = ? AND token_hash <> ?)
        AND (EXISTS (SELECT 1 FROM diagnostic_reports WHERE id = ?) OR EXISTS (SELECT 1 FROM diagnostic_withdrawals WHERE id = ?)
          OR (SELECT count(*) FROM diagnostic_withdrawals WHERE withdrawn_at >= ? AND unknown_report = 1) < ?)
        ON CONFLICT(id) DO NOTHING`).bind(id.data, hash, input.data.withdrawnAt, now, id.data, hash, id.data, hash, id.data, id.data, day.start, DAILY_UNKNOWN_WITHDRAWAL_LIMIT).run()
      const saved = await env.DB.prepare('SELECT withdrawn_at FROM diagnostic_withdrawals WHERE id = ? AND token_hash = ?').bind(id.data, hash).first<{ withdrawn_at: string }>()
      if (!saved) {
        const existing = await env.DB.prepare('SELECT id FROM diagnostic_reports WHERE id = ? UNION ALL SELECT id FROM diagnostic_withdrawals WHERE id = ? LIMIT 1').bind(id.data, id.data).first()
        return existing ? json({ error: 'The diagnostic credential does not match.' }, 401) : limited(day.retry)
      }
      return json({ id: id.data, status: 'withdrawn', withdrawnAt: saved.withdrawn_at })
    }
    const parsed = diagnosticSubmissionSchema.safeParse(body)
    if (!parsed.success) return json({ error: 'Only the supported diagnostic fields are accepted. Generate a new report.' }, 400)
    const { report, consent, token } = parsed.data
    if (consent.version !== DIAGNOSTIC_VERSION || consent.text !== diagnosticText(url.origin)) return json({ error: 'Read and accept the current diagnostic consent.' }, 409)
    if (Date.parse(consent.acceptedAt) > Date.now() + 300000 || Date.parse(report.generatedAt) > Date.now() + 300000) return json({ error: 'Check the device clock before sending.' }, 400)
    const hash = await digest(JSON.stringify({ report, consent }))
    const tokenHash = await digest(token)
    await expireDiagnostics(env.DB, now)
    const insert = await env.DB.prepare(`INSERT INTO diagnostic_reports (id, token_hash, content_hash, report_json, consent_version, consent_text, accepted_at, recorded_at, expires_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM diagnostic_withdrawals WHERE id = ?)
      AND (EXISTS (SELECT 1 FROM diagnostic_reports WHERE id = ?) OR (SELECT count(*) FROM diagnostic_reports WHERE recorded_at >= ?) < ?)
      ON CONFLICT(id) DO NOTHING`).bind(report.id, tokenHash, hash, JSON.stringify(report), consent.version, consent.text, consent.acceptedAt, now, new Date(Date.parse(now) + RETENTION_MS).toISOString(), report.id, report.id, day.start, DAILY_REPORT_LIMIT).run()
    const saved = await env.DB.prepare('SELECT * FROM diagnostic_reports WHERE id = ?').bind(report.id).first<StoredReport>()
    if (saved && (saved.token_hash !== tokenHash || saved.content_hash !== hash)) return json({ error: 'This report ID already belongs to a different submission.' }, 409)
    if (!saved) {
      const withdrawn = await env.DB.prepare('SELECT id FROM diagnostic_withdrawals WHERE id = ?').bind(report.id).first()
      return withdrawn ? json({ error: 'This report was withdrawn. It cannot be sent again.' }, 410) : limited(day.retry)
    }
    if (saved.withdrawn_at || !saved.report_json) return json({ error: 'This report was withdrawn or expired. It cannot be sent again.' }, 410)
    return json({ id: saved.id, status: 'received', receivedAt: saved.recorded_at, expiresAt: saved.expires_at, consent: { version: saved.consent_version, text: saved.consent_text, acceptedAt: saved.accepted_at, recordedAt: saved.recorded_at } }, insert.meta.changes ? 201 : 200)
  } catch { return fail('diagnostics_d1', 'Diagnostics are unavailable. Keep the report locally and retry.') }
}
