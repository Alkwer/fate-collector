import type { Offer } from '../../shared/schema'

export async function collectionStatus(): Promise<boolean> {
  const response = await fetch('/api/status', { signal: AbortSignal.timeout(5000) })
  if (!response.ok) return false
  const body = await response.json() as { ingestionEnabled?: boolean }
  return body.ingestionEnabled === true
}
export async function submitOffer(offer: Offer, accessKey: string): Promise<void> {
  const response = await fetch('/api/observations', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessKey}` }, body: JSON.stringify(offer), signal: AbortSignal.timeout(15000) })
  const body = await response.json().catch(() => ({})) as { error?: string; id?: string; revision?: number; status?: string }
  if (!response.ok) throw new Error(body.error || `Submission failed (${response.status}). Your offer is still saved locally.`)
  if (body.id !== offer.id || body.revision !== offer.revision || !['accepted', 'duplicate'].includes(body.status || '')) throw new Error('The server returned an unexpected receipt. Your offer remains local; retry safely.')
}
