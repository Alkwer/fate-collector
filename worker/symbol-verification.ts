import { digest, json } from './http'
import type { ReportFailure } from './observability'

export interface SymbolVerificationEnv {
  DB?: D1Database; DIAGNOSTIC_RATE_LIMITER?: RateLimit; APP_ENV?: string;
  TURNSTILE_SECRET?: string; TURNSTILE_SITEKEY?: string; TURNSTILE_HOSTNAMES?: string;
}
export function symbolReportingEnabled(env: SymbolVerificationEnv) {
  const hosts = (env.TURNSTILE_HOSTNAMES || '').split(',').map(host => host.trim()).filter(Boolean)
  return Boolean(env.DB && env.DIAGNOSTIC_RATE_LIMITER && env.TURNSTILE_SECRET?.trim() && env.TURNSTILE_SITEKEY?.trim() && hosts.length &&
    (env.APP_ENV === 'local' || (!hosts.some(host => ['localhost', '127.0.0.1', '::1'].includes(host)) && env.TURNSTILE_SITEKEY?.startsWith('0x') && env.TURNSTILE_SECRET?.startsWith('0x'))))
}
export function verificationRequired() {
  return json({ code: 'verification-required', error: 'Complete the security check and try again.' }, 403)
}
export async function verifySymbolRequest(request: Request, env: SymbolVerificationEnv, action: 'symbol-report' | 'symbol-withdraw', id: string, fail: ReportFailure): Promise<Response | null> {
  if (!symbolReportingEnabled(env)) return fail('symbols_siteverify_configuration', 'Symbol reporting verification is unavailable. Your local report is kept.')
  const token = request.headers.get('X-Turnstile-Token')
  if (!token || token.length > 2048) return verificationRequired()
  const allowed = new Set(env.TURNSTILE_HOSTNAMES!.split(',').map(host => host.trim()))
  if (!allowed.has(new URL(request.url).hostname)) return verificationRequired()
  const unavailable = 'The security check is unavailable. Your local report is kept; retry later.'
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(10000),
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET!, response: token, ...(request.headers.get('CF-Connecting-IP') ? { remoteip: request.headers.get('CF-Connecting-IP')! } : {}) }),
    })
    if (!response.ok) return fail('symbols_siteverify_service', unavailable)
    const result = await response.json() as { success?: unknown; hostname?: string; action?: string; cdata?: string; challenge_ts?: string; 'error-codes'?: string[] }
    if (result['error-codes']?.some(code => ['invalid-input-secret', 'missing-input-secret'].includes(code))) return fail('symbols_siteverify_configuration', unavailable)
    if (result['error-codes']?.includes('internal-error')) return fail('symbols_siteverify_service', unavailable)
    const age = Date.now() - Date.parse(result.challenge_ts || '')
    if (result.success !== true || !allowed.has(result.hostname || '') || result.action !== action || result.cdata !== id || !Number.isFinite(age) || age < -30000 || age > 300000) return verificationRequired()
  } catch { return fail('symbols_siteverify_service', unavailable) }
  try {
    const now = new Date().toISOString(), hash = await digest(token)
    await env.DB!.prepare('DELETE FROM symbol_challenges WHERE expires_at <= ?').bind(now).run()
    const inserted = await env.DB!.prepare(`INSERT INTO symbol_challenges (token_hash, expires_at)
      SELECT ?, ? WHERE (SELECT count(*) FROM symbol_challenges) < 2000 ON CONFLICT(token_hash) DO NOTHING`)
      .bind(hash, new Date(Date.now() + 600000).toISOString()).run()
    if (!inserted.meta.changes) {
      if (await env.DB!.prepare('SELECT token_hash FROM symbol_challenges WHERE token_hash = ?').bind(hash).first()) return verificationRequired()
      return json({ error: 'Security checks are busy. Your local report is kept; retry later.' }, 429)
    }
    return null
  } catch { return fail('symbols_challenge_d1', unavailable) }
}
