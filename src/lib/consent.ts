import { z } from '../../shared/validation'
import { CONSENT_VERSION, consentGrantSchema, consentText, type ConsentReceipt } from '../../shared/consent'
import { logDiagnostic } from './diagnostic-log'
import { readLocalHistory } from './local-history'

const prefix = 'fate-collector.consent.observations.'
const activeKey = `${prefix}active`
const changedEvent = 'fate-consent-change'
const date = z.string().datetime({ offset: true }).nullable()
const recordSchema = consentGrantSchema.extend({ recordedAt: date, withdrawnAt: date, withdrawalConfirmedAt: date, blocked: z.boolean(), withdrawalRetryAt: z.string().datetime({ offset: true }).optional() })
export type LocalConsent = z.infer<typeof recordSchema>
let sessionBlocked = false
export function consentHistory() {
  const history = readLocalHistory(prefix, value => recordSchema.parse(value), [activeKey])
  history.records.sort((a, b) => b.acceptedAt.localeCompare(a.acceptedAt))
  return history
}
export function consentRecords(): LocalConsent[] { return consentHistory().records }
export function selectedConsent(): LocalConsent | null {
  if (sessionBlocked) return null
  const id = localStorage.getItem(activeKey)
  return consentRecords().find(record => record.id === id) || null
}
export function isCurrentConsent(record: LocalConsent | null): record is LocalConsent {
  return Boolean(record && !record.withdrawnAt && !record.blocked && record.policyVersion === CONSENT_VERSION && record.text === consentText('observations', location.origin))
}
export function sharingConsent(): LocalConsent | null {
  try {
    const record = selectedConsent()
    return isCurrentConsent(record) && record.recordedAt ? record : null
  } catch { return null } // Unreadable/missing evidence cannot authorize a send.
}
function save(record: LocalConsent) {
  const previous = localStorage.getItem(prefix + record.id)
  const saved = previous ? recordSchema.parse(JSON.parse(previous)) : null
  // A delayed registration response cannot undo a withdrawal from another tab.
  if (saved?.withdrawnAt) record = { ...record, withdrawnAt: saved.withdrawnAt, withdrawalConfirmedAt: saved.withdrawalConfirmedAt, withdrawalRetryAt: record.withdrawalRetryAt || saved.withdrawalRetryAt }
  localStorage.setItem(prefix + record.id, JSON.stringify(recordSchema.parse(record)))
  window.dispatchEvent(new Event(changedEvent))
}
export function onConsentChange(listener: () => void) {
  window.addEventListener('storage', listener)
  window.addEventListener(changedEvent, listener)
  return () => { window.removeEventListener('storage', listener); window.removeEventListener(changedEvent, listener) }
}
export async function acceptConsent(accessKey: string, agreed: boolean): Promise<void> {
  if (!agreed || !accessKey.trim()) throw new Error('Read the consent information, tick the checkbox and enter your collection key.')
  const token = [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, '0')).join('')
  const record: LocalConsent = { id: crypto.randomUUID(), scope: 'observations', policyVersion: CONSENT_VERSION, acceptedAt: new Date().toISOString(), text: consentText('observations', location.origin), token, recordedAt: null, withdrawnAt: null, withdrawalConfirmedAt: null, blocked: false }
  save(record)
  localStorage.setItem(activeKey, record.id)
  sessionBlocked = false
  window.dispatchEvent(new Event(changedEvent))
  await registerConsent(accessKey)
}
export async function registerConsent(accessKey: string): Promise<void> {
  const record = selectedConsent()
  if (!isCurrentConsent(record) || !accessKey.trim()) throw new Error('A current local consent and collection key are required.')
  const grant = consentGrantSchema.parse({ id: record.id, scope: record.scope, policyVersion: record.policyVersion, acceptedAt: record.acceptedAt, text: record.text, token: record.token })
  const response = await fetch('/api/consents', { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessKey}` }, body: JSON.stringify(grant), signal: AbortSignal.timeout(10000) })
  logDiagnostic('consent-register', response.ok ? 'ok' : 'error', response.status)
  if (!response.ok) {
    if ([403, 409].includes(response.status)) save({ ...record, blocked: true })
    throw new Error(`Consent could not be confirmed (${response.status}). Sharing remains off.`)
  }
  const receipt = await response.json() as ConsentReceipt
  if (![200, 201].includes(response.status) || receipt.id !== record.id || receipt.scope !== record.scope || receipt.policyVersion !== record.policyVersion || receipt.text !== record.text || receipt.acceptedAt !== record.acceptedAt || receipt.withdrawnAt !== null || !z.string().datetime({ offset: true }).safeParse(receipt.recordedAt).success) throw new Error('Unexpected consent receipt. Sharing remains off; retry confirmation.')
  save({ ...record, recordedAt: receipt.recordedAt })
}
export function blockConsent(id: string) {
  const record = consentRecords().find(item => item.id === id)
  if (record) save({ ...record, blocked: true })
}
export async function withdrawConsent(id: string): Promise<void> {
  const record = consentRecords().find(item => item.id === id)
  if (!record) throw new Error('This consent record is unavailable.')
  sessionBlocked = localStorage.getItem(activeKey) === id
  try {
    // Removing the pointer also stops other tabs before persisting the longer audit record.
    if (localStorage.getItem(activeKey) === id) localStorage.removeItem(activeKey)
    save({ ...record, withdrawnAt: record.withdrawnAt || new Date().toISOString() })
  } finally { window.dispatchEvent(new Event(changedEvent)) }
  await retryWithdrawals()
}
export async function retryWithdrawals(): Promise<void> {
  let failure: unknown
  for (const record of consentRecords().filter(item => item.withdrawnAt && !item.withdrawalConfirmedAt)) {
    if (record.withdrawalRetryAt && Date.parse(record.withdrawalRetryAt) > Date.now()) continue
    try {
      const response = await fetch(`/api/consents/${record.id}/withdraw`, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', 'X-Consent-Token': record.token }, body: JSON.stringify({ withdrawnAt: record.withdrawnAt }), signal: AbortSignal.timeout(10000) })
      logDiagnostic('consent-withdraw', response.ok ? 'ok' : 'error', response.status)
      if (response.status === 429) {
        const seconds = Number(response.headers.get('Retry-After'))
        const delay = Number.isFinite(seconds) && seconds >= 1 ? Math.min(seconds, 86400) : 60
        save({ ...record, withdrawalRetryAt: new Date(Date.now() + delay * 1000).toISOString() })
      }
      if (!response.ok) throw new Error('Sharing is off locally. Server withdrawal is pending; it will retry when connected.')
      const receipt = await response.json() as { id?: string; status?: string; withdrawnAt?: string }
      if (receipt.id !== record.id || receipt.status !== 'withdrawn' || !z.string().datetime({ offset: true }).safeParse(receipt.withdrawnAt).success) throw new Error('Sharing is off locally. Server withdrawal has not been confirmed.')
      // Preserve the original local withdrawal time and the separately acknowledged server time.
      const latest = recordSchema.parse(JSON.parse(localStorage.getItem(prefix + record.id)!))
      localStorage.setItem(prefix + record.id, JSON.stringify({ ...latest, withdrawalConfirmedAt: receipt.withdrawnAt }))
      window.dispatchEvent(new Event(changedEvent))
    } catch (error) { failure = error }
  }
  if (failure) throw failure
}
export function exportConsentRecords() {
  const records = consentRecords().map(({ token: _credential, ...record }) => record)
  const url = URL.createObjectURL(new Blob([JSON.stringify(records, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a'); link.href = url; link.download = 'fate-collector-consent-history.json'; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function parsePrivateConsents(input: unknown) {
  const records = z.array(recordSchema).max(1000).parse(input)
  if (new Set(records.map(record => record.id)).size !== records.length) throw new Error('Duplicate consent identifiers in private backup.')
  if (records.some(record => record.withdrawalConfirmedAt && !record.withdrawnAt)) throw new Error('Invalid withdrawal state in private backup.')
  return records
}
export function restorePrivateConsents(input: unknown) {
  const records = parsePrivateConsents(input)
  let restored = 0, conflicts = 0
  for (const record of records) {
    const text = localStorage.getItem(prefix + record.id)
    let old: ReturnType<typeof recordSchema.safeParse> | null = null
    try { old = text ? recordSchema.safeParse(JSON.parse(text)) : null } catch { conflicts++; continue }
    if (old && (!old.success || old.data.token !== record.token || old.data.text !== record.text || old.data.acceptedAt !== record.acceptedAt)) { conflicts++; continue }
    // Import never activates sharing. Existing withdrawal and blocking state win.
    const existing = old?.success ? old.data : null
    save(existing ? { ...existing, withdrawnAt: existing.withdrawnAt || record.withdrawnAt,
      withdrawalConfirmedAt: existing.withdrawalConfirmedAt || record.withdrawalConfirmedAt,
      blocked: existing.blocked || !!record.withdrawnAt } : { ...record, blocked: true })
    restored++
  }
  return { restored, conflicts }
}
