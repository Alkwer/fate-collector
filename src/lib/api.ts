import type { Offer } from '../../shared/schema'
import { blockConsent, sharingConsent } from './consent'
import { logDiagnostic } from './diagnostic-log'

export async function collectionStatus(): Promise<boolean> {
  return (await collectionInfo()).ingestionEnabled
}
export async function collectionInfo(): Promise<{ ingestionEnabled: boolean; environment: string }> {
  const response = await fetch('/api/status', { signal: AbortSignal.timeout(5000) }).catch(error => { logDiagnostic('api-status', 'error'); throw error })
  logDiagnostic('api-status', response.ok ? 'ok' : 'error', response.status)
  if (!response.ok) return { ingestionEnabled: false, environment: 'unknown' }
  const body = await response.json() as { ingestionEnabled?: boolean; environment?: string }
  return { ingestionEnabled: body.ingestionEnabled === true, environment: body.environment || 'unknown' }
}
export async function submitOffer(offer: Offer, accessKey: string): Promise<string> {
  const consent = sharingConsent()
  if (!consent) throw new Error('Accept data sharing before sending an offer.')
  const response = await fetch('/api/observations', { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessKey}`, 'X-Consent-Id': consent.id, 'X-Consent-Token': consent.token }, body: JSON.stringify(offer), signal: AbortSignal.timeout(15000) }).catch(error => { logDiagnostic('upload', 'error'); throw error })
  logDiagnostic('upload', response.ok ? 'ok' : 'error', response.status)
  const body = await response.json().catch(() => ({})) as { error?: string; id?: string; revision?: number; status?: string }
  if (!response.ok) {
    if ([403, 428].includes(response.status)) blockConsent(consent.id)
    throw new Error(body.error || `Submission failed (${response.status}). Your offer is still saved locally.`)
  }
  if (body.id !== offer.id || body.revision !== offer.revision || !['accepted', 'duplicate'].includes(body.status || '')) throw new Error('The server returned an unexpected receipt. Your offer remains local; retry safely.')
  return consent.id
}
