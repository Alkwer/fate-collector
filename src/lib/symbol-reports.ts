import { z } from '../../shared/validation'
import { symbolReceiptSchema, type SymbolReport } from '../../shared/symbol-reports'
import { checkSymbolUpload, readSymbolReviewCredential, readSymbolSubmission, updateSymbolSummary } from './symbol-report-storage'

export { saveSymbolSubmission, symbolReportHistory, type LocalSymbolReport } from './symbol-report-storage'

export type SymbolVerification = (action: 'symbol-report' | 'symbol-withdraw', id: string) => Promise<string>
const reviewStatusSchema = z.object({ id: z.string().uuid(), status: z.enum(['pending', 'in-review', 'accepted', 'rejected', 'conflict']) }).strict()
export async function readSymbolReviewStatus(id: string) {
  const token = await readSymbolReviewCredential(id)
  const response = await fetch(`/api/symbol-reports/${id}/review-status`, {
    method: 'POST', redirect: 'error', headers: { 'X-Symbol-Token': token }, signal: AbortSignal.timeout(15000),
  }).catch(() => { throw new Error('Could not check review status. Check your connection and try again.') })
  if (response.status === 410) {
    await updateSymbolSummary(id, latest => ({ ...latest, expired: true }))
    throw new Error('This report expired or was removed from the collection.')
  }
  if (response.status === 429) throw new Error('Too many status checks. Try again later.')
  const result = reviewStatusSchema.safeParse(await response.json().catch(() => null))
  if (!response.ok || !result.success || result.data.id !== id) throw new Error('Review status is unavailable.')
  return result.data.status
}

export async function sendSymbolReport(id: string, verify: SymbolVerification) {
  await checkSymbolUpload(id)
  const token = await verify('symbol-report', id)
  // Another tab may have requested withdrawal while verification was open.
  const submission = await readSymbolSubmission(id)
  const response = await fetch('/api/symbol-reports', { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', 'X-Turnstile-Token': token }, body: JSON.stringify(submission), signal: AbortSignal.timeout(30000) })
    .catch(() => { throw new Error('Upload not confirmed. Check your connection and retry the saved report.') })
  const body = await response.json().catch(() => ({}))
  if (response.status === 410) await updateSymbolSummary(id, latest => ({ ...latest, expired: true }))
  if (!response.ok) throw new Error(z.object({ error: z.string() }).safeParse(body).data?.error || 'Report not confirmed. Retry the saved report below.')
  const receipt = symbolReceiptSchema.safeParse(body)
  const { consent } = submission
  if (!receipt.success || receipt.data.id !== id || receipt.data.consent.version !== consent.version || receipt.data.consent.text !== consent.text || receipt.data.consent.acceptedAt !== consent.acceptedAt || receipt.data.consent.recordedAt !== receipt.data.receivedAt) throw new Error('Unexpected receipt. Retry the saved report below.')
  await updateSymbolSummary(id, latest => ({ ...latest, receipt: receipt.data }))
}
export async function withdrawSymbolReport(id: string, verify?: SymbolVerification) {
  const row = await updateSymbolSummary(id, latest => ({ ...latest, withdrawRequestedAt: latest.withdrawRequestedAt || new Date().toISOString() }))
  async function send(token?: string) {
    const headers = new Headers({ 'Content-Type': 'application/json', 'X-Symbol-Token': row.token })
    if (token) headers.set('X-Turnstile-Token', token)
    const response = await fetch(`/api/symbol-reports/${id}/withdraw`, { method: 'POST', redirect: 'error', headers, body: JSON.stringify({ withdrawnAt: row.withdrawRequestedAt }), signal: AbortSignal.timeout(15000) })
      .catch(() => { throw new Error('Withdrawal not confirmed. Check your connection and retry withdrawal.') })
    return { response, body: await response.json().catch(() => ({})) }
  }
  let { response, body } = await send()
  const verificationRequired = z.object({ code: z.literal('verification-required') }).safeParse(body).success
  if (verify && response.status === 403 && verificationRequired) {
    ({ response, body } = await send(await verify('symbol-withdraw', id)))
  }
  const receipt = z.object({ id: z.string().uuid(), status: z.literal('withdrawn'), withdrawnAt: z.string().datetime({ offset: true }) }).safeParse(body)
  if (!response.ok || !receipt.success || receipt.data.id !== id) throw new Error(z.object({ error: z.string() }).safeParse(body).data?.error || 'Withdrawal not confirmed. Retry withdrawal below; sending is blocked locally.')
  await updateSymbolSummary(id, latest => ({ ...latest, withdrawnAt: receipt.data.withdrawnAt }))
}
export function symbolImageUrl(image: SymbolReport['icon']) { return `data:image/png;base64,${image.dataBase64}` }
/** Canvas encoders may add ancillary chunks (including browser debug metadata).
 * Keep only image data and the sRGB rendering intent before preview and submission. */
export function stripCanvasPngMetadata(base64: string): string {
  const binary = atob(base64), bytes = Uint8Array.from(binary, char => char.charCodeAt(0)), view = new DataView(bytes.buffer)
  let output = binary.slice(0, 8), offset = 8
  while (offset + 12 <= bytes.length) {
    const size = view.getUint32(offset), end = offset + size + 12, kind = binary.slice(offset + 4, offset + 8)
    if (end > bytes.length) throw new Error('Could not prepare the PNG image.')
    if (['IHDR', 'IDAT', 'IEND', 'sRGB'].includes(kind)) output += binary.slice(offset, end)
    offset = end
  }
  if (offset !== bytes.length) throw new Error('Could not prepare the PNG image.')
  return btoa(output)
}
export async function prepareSymbolImage(source: Blob | string, kind: 'icon' | 'tooltip', crop?: { x: number; y: number; width: number; height: number }): Promise<SymbolReport['icon']> {
  let blob: Blob
  if (typeof source === 'string') {
    const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/.exec(source)
    if (!match || source.length > 16 * 1024 * 1024) throw new Error('The local capture image is invalid or too large.')
    blob = new Blob([Uint8Array.from(atob(match[2]), char => char.charCodeAt(0))], { type: match[1] })
  } else blob = source
  if (blob.size > 12 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(blob.type)) throw new Error('Choose a PNG, JPEG or WebP image up to 12 MiB.')
  const bitmap = await createImageBitmap(blob)
  try {
    if (bitmap.width * bitmap.height > 16_777_216) throw new Error('Image is too large. Crop it before importing.')
    const box = crop || { x: 0, y: 0, width: bitmap.width, height: bitmap.height }
    if (![box.x, box.y, box.width, box.height].every(Number.isInteger) || box.width < 8 || box.height < 8 || box.x < 0 || box.y < 0 || box.x + box.width > bitmap.width || box.y + box.height > bitmap.height) throw new Error('Select a rectangle of at least 8 × 8 pixels inside the image.')
    const limit = kind === 'icon' ? 256 : 1600, scale = Math.min(1, limit / Math.max(box.width, box.height))
    const canvas = document.createElement('canvas'); canvas.width = Math.max(8, Math.round(box.width * scale)); canvas.height = Math.max(8, Math.round(box.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Image processing is unavailable.')
    context.drawImage(bitmap, box.x, box.y, box.width, box.height, 0, 0, canvas.width, canvas.height)
    const dataBase64 = stripCanvasPngMetadata(canvas.toDataURL('image/png').split(',')[1])
    if (dataBase64.length > (kind === 'icon' ? 87384 : 524288)) throw new Error('Image is too large. Crop more tightly around the symbol or tooltip.')
    return { mimeType: 'image/png', width: canvas.width, height: canvas.height, dataBase64 }
  } finally { bitmap.close() }
}
