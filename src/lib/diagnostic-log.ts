import { diagnosticEventSchema, type DiagnosticEvent } from '../../shared/diagnostics'

const key = 'fate-collector.diagnostic-events.v1'
const events: DiagnosticEvent[] = []
export function diagnosticEvents(): DiagnosticEvent[] {
  let stored: unknown = []
  try { stored = JSON.parse(localStorage.getItem(key) || '[]') } catch { /* Memory-only logging still works. */ }
  const safe = Array.isArray(stored) ? stored.slice(-100).flatMap(item => { const result = diagnosticEventSchema.safeParse(item); return result.success ? [result.data] : [] }) : []
  return [...safe, ...events].filter((event, index, all) => all.findIndex(other => JSON.stringify(event) === JSON.stringify(other)) === index).slice(-100)
}
// No messages, URLs, stack traces or objects are accepted here. Runtime validation
// also protects calls from JS and corrupted local log entries.
export function logDiagnostic(code: DiagnosticEvent['code'], outcome: DiagnosticEvent['outcome'], httpStatus: number | null = null) {
  const parsed = diagnosticEventSchema.safeParse({ at: new Date().toISOString(), code, outcome, httpStatus })
  if (!parsed.success) return
  events.push(parsed.data)
  if (events.length > 100) events.shift()
  try { localStorage.setItem(key, JSON.stringify(diagnosticEvents())) } catch { /* Diagnostics must not prevent capture or review. */ }
}
export function clearDiagnosticLog() { localStorage.removeItem(key); events.length = 0 }
export function installDiagnosticLog() {
  const failure = () => logDiagnostic('runtime-error', 'error')
  window.addEventListener('error', failure)
  window.addEventListener('unhandledrejection', failure)
  logDiagnostic('app-start', 'ok')
  return () => { window.removeEventListener('error', failure); window.removeEventListener('unhandledrejection', failure) }
}
