import { json } from './http'

type FailureCode =
  | 'collection_configuration' | 'capture_d1' | 'observation_d1'
  | 'consent_configuration' | 'consent_rate_limiter' | 'consent_d1'
  | 'diagnostics_configuration' | 'diagnostics_rate_limiter' | 'diagnostics_d1'
  | 'symbols_configuration' | 'symbols_rate_limiter' | 'symbols_d1'
  | 'symbols_siteverify_configuration' | 'symbols_siteverify_service' | 'symbols_challenge_d1'
  | 'unexpected_api_failure'

export type ReportFailure = (code: FailureCode, message: string, status?: 500 | 503) => Response

export function reportFailure(requestId: string): ReportFailure {
  return (code, message, status = 503) => {
    console.error({ event: 'api_failure', code, requestId, status, count: 1 })
    return json({ error: message }, status)
  }
}

export function logCleanup(requestId: string, task: 'diagnostics' | 'symbols', status: 'completed' | 'd1_failed' | 'missing_binding') {
  const event = { event: 'retention_cleanup', task, status, requestId, count: 1 }
  if (status === 'completed') console.info(event)
  else console.error(event)
}
