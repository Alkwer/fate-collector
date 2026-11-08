import type { Offer } from '../../shared/schema'

export async function collectionStatus(): Promise<boolean> {
  return (await collectionInfo()).ingestionEnabled
}
export async function collectionInfo(): Promise<{ ingestionEnabled: boolean; environment: string }> {
  const response = await fetch('/api/status', { signal: AbortSignal.timeout(5000) })
  if (!response.ok) return { ingestionEnabled: false, environment: 'unknown' }
  const body = await response.json() as { ingestionEnabled?: boolean; environment?: string }
  return { ingestionEnabled: body.ingestionEnabled === true, environment: body.environment || 'unknown' }
}
export async function submitOffer(offer: Offer, accessKey: string): Promise<void> {
  const response = await fetch('/api/observations', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessKey}` }, body: JSON.stringify(offer), signal: AbortSignal.timeout(15000) })
  const body = await response.json().catch(() => ({})) as { error?: string; id?: string; revision?: number; status?: string }
  if (!response.ok) throw new Error(body.error || `Submission failed (${response.status}). Your offer is still saved locally.`)
  if (body.id !== offer.id || body.revision !== offer.revision || !['accepted', 'duplicate'].includes(body.status || '')) throw new Error('The server returned an unexpected receipt. Your offer remains local; retry safely.')
}
