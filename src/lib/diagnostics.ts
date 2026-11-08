import { z } from 'zod'
import { zipSync, strToU8 } from 'fflate'
import { APP_VERSION, DIAGNOSTIC_VERSION, RETENTION_MS, diagnosticReportSchema, diagnosticSubmissionSchema, diagnosticReceiptSchema, diagnosticWithdrawalSchema, diagnosticText, type DiagnosticReport } from '../../shared/diagnostics'
import { diagnosticEvents, logDiagnostic } from './diagnostic-log'

const prefix = 'fate-collector.diagnostic-report.'
const changed = 'fate-diagnostic-change'
const localDate = z.string().datetime({ offset: true })
const localSchema = diagnosticSubmissionSchema.extend({ receipt: diagnosticReceiptSchema.nullable(), withdrawnAt: localDate.nullable(), withdrawalConfirmedAt: localDate.nullable(), retryAt: localDate.optional(), deletionRetryAt: localDate.optional() }).strict()
export type DiagnosticRecord = z.infer<typeof localSchema>
export function diagnosticHistory(): DiagnosticRecord[] {
  const result: DiagnosticRecord[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)!
    if (key.startsWith(prefix)) result.push(localSchema.parse(JSON.parse(localStorage.getItem(key)!)))
  }
  return result.sort((a, b) => b.consent.acceptedAt.localeCompare(a.consent.acceptedAt))
}
function save(record: DiagnosticRecord) {
  const previous = localStorage.getItem(prefix + record.report.id)
  if (previous) {
    const old = localSchema.parse(JSON.parse(previous))
    if (old.withdrawnAt) record = { ...record, withdrawnAt: old.withdrawnAt, withdrawalConfirmedAt: old.withdrawalConfirmedAt }
  }
  localStorage.setItem(prefix + record.report.id, JSON.stringify(localSchema.parse(record)))
  window.dispatchEvent(new Event(changed))
}
export function onDiagnosticChange(listener: () => void) {
  window.addEventListener('storage', listener); window.addEventListener(changed, listener)
  return () => { window.removeEventListener('storage', listener); window.removeEventListener(changed, listener) }
}
export function generateDiagnostic(environment: string, folderConnection: DiagnosticReport['state']['folderConnection'], sharing: DiagnosticReport['state']['sharing']): DiagnosticReport {
  logDiagnostic('diagnostics-generate', 'ok')
  let storage: DiagnosticReport['state']['storage'] = 'unavailable'
  try { const probe = `${prefix}probe`; localStorage.setItem(probe, '1'); localStorage.removeItem(probe); storage = 'available' } catch { /* The report must remain downloadable. */ }
  const ua = navigator.userAgent
  const family = /(?:Chrome|Chromium|Edg)\//.test(ua) ? 'chromium' : /Firefox\//.test(ua) ? 'firefox' : /Safari\//.test(ua) ? 'safari' : 'other'
  const version = /(?:Chrome|Firefox|Version)\/(\d{1,5})/.exec(ua)?.[1] || null
  const platform = /Windows/.test(ua) ? 'windows' : /Macintosh/.test(ua) ? 'macos' : /Linux/.test(ua) ? 'linux' : 'other'
  return diagnosticReportSchema.parse({
    kind: 'fate-collector.diagnostics', schemaVersion: 1, id: crypto.randomUUID(), generatedAt: new Date().toISOString(), source: 'website', appVersion: APP_VERSION,
    environment: ['local', 'staging', 'production'].includes(environment) ? environment : 'unknown',
    runtime: { family, version, platform, online: navigator.onLine },
    state: { storage, folderConnection, sharing, queue: { pending: 0, accepted: 0, rejected: 0, ignored: 0 } },
    events: diagnosticEvents(),
  })
}
export function diagnosticZip(report: DiagnosticReport): Uint8Array {
  // Only this schema is serialized, never a receipt, key store, log file or arbitrary attachment.
  return zipSync({ 'diagnostics.json': strToU8(JSON.stringify(diagnosticReportSchema.parse(report), null, 2)) })
}
export function downloadDiagnostic(report: DiagnosticReport) {
  const bytes = diagnosticZip(report)
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/zip' }))
  const link = document.createElement('a'); link.href = url; link.download = `fate-diagnostics-${report.id}.zip`; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export async function sendDiagnostic(report: DiagnosticReport, key: string, agreed: boolean) {
  if (!agreed || !key.trim()) throw new Error('Read the report and consent, tick the checkbox and enter a collection access key.')
  report = diagnosticReportSchema.parse(report)
  let record = diagnosticHistory().find(item => item.report.id === report.id)
  if (record && (record.withdrawnAt || JSON.stringify(record.report) !== JSON.stringify(report))) throw new Error('This report was changed or withdrawn. Generate a new report.')
  if (record?.retryAt && Date.parse(record.retryAt) > Date.now()) throw new Error(`Diagnostic limit reached. Try again after ${new Date(record.retryAt).toLocaleTimeString()}. Your report stays local.`)
  if (!record) {
    if (diagnosticHistory().length >= 50) throw new Error('Local diagnostic history is full. Keep your receipts and contact the operator before clearing site data.')
    record = { report, consent: { version: DIAGNOSTIC_VERSION, text: diagnosticText(location.origin), acceptedAt: new Date().toISOString() }, token: [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, '0')).join(''), receipt: null, withdrawnAt: null, withdrawalConfirmedAt: null }
    save(record) // Persist the deletion credential before the first network write.
  }
  if (record.consent.version !== DIAGNOSTIC_VERSION || record.consent.text !== diagnosticText(location.origin)) throw new Error('The diagnostic consent changed. Generate a new report.')
  const response = await fetch('/api/diagnostics', { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key.trim()}` }, body: JSON.stringify({ report: record.report, consent: record.consent, token: record.token }), signal: AbortSignal.timeout(10000) })
  logDiagnostic('diagnostics-upload', response.ok ? 'ok' : 'error', response.status)
  if (response.status === 429) {
    const retryAt = retryDate(response)
    save({ ...record, retryAt })
    throw new Error(`Diagnostic limit reached. Try again after ${new Date(retryAt).toLocaleTimeString()}. Your report stays local.`)
  }
  if (!response.ok) throw new Error(`Diagnostic submission was not confirmed (${response.status}). The saved receipt lets you retry or delete this report.`)
  const receipt = diagnosticReceiptSchema.safeParse(await response.json())
  if (!receipt.success || ![200, 201].includes(response.status) || receipt.data.id !== report.id || receipt.data.consent.version !== record.consent.version || receipt.data.consent.text !== record.consent.text || receipt.data.consent.acceptedAt !== record.consent.acceptedAt || receipt.data.consent.recordedAt !== receipt.data.receivedAt || Date.parse(receipt.data.expiresAt) - Date.parse(receipt.data.receivedAt) !== RETENTION_MS) throw new Error('Unexpected diagnostic receipt. Sending is not confirmed; retry or delete using the saved record.')
  save({ ...record, receipt: receipt.data })
}
export async function withdrawDiagnostic(id: string) {
  const record = diagnosticHistory().find(item => item.report.id === id)
  if (!record) throw new Error('The local deletion credential is unavailable.')
  save({ ...record, withdrawnAt: record.withdrawnAt || new Date().toISOString() })
  await retryDiagnosticWithdrawals()
}
export async function retryDiagnosticWithdrawals() {
  let failure: unknown
  for (const record of diagnosticHistory().filter(item => item.withdrawnAt && !item.withdrawalConfirmedAt)) {
    if (record.deletionRetryAt && Date.parse(record.deletionRetryAt) > Date.now()) continue
    try {
      const response = await fetch(`/api/diagnostics/${record.report.id}/withdraw`, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', 'X-Diagnostic-Token': record.token }, body: JSON.stringify({ withdrawnAt: record.withdrawnAt }), signal: AbortSignal.timeout(10000) })
      if (response.status === 429) { save({ ...record, deletionRetryAt: retryDate(response) }); throw new Error('Deletion rate limited.') }
      const receipt = diagnosticWithdrawalSchema.safeParse(await response.json())
      if (response.status !== 200 || !receipt.success || receipt.data.id !== record.report.id) throw new Error('Deletion is pending. Keep the saved receipt; retry when connected.')
      const latest = diagnosticHistory().find(item => item.report.id === record.report.id)!
      localStorage.setItem(prefix + record.report.id, JSON.stringify({ ...latest, withdrawalConfirmedAt: receipt.data.withdrawnAt }))
      window.dispatchEvent(new Event(changed))
      logDiagnostic('diagnostics-withdraw', 'ok')
    } catch { failure = new Error('Deletion is pending. It will retry when connected or when you reopen this site.') }
  }
  if (failure) throw failure
}
function retryDate(response: Response): string {
  const seconds = Number(response.headers.get('Retry-After'))
  return new Date(Date.now() + (Number.isFinite(seconds) && seconds >= 1 ? Math.min(seconds, 86400) : 60) * 1000).toISOString()
}
