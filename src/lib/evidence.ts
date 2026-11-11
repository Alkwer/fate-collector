import { evidenceSchema, type Evidence } from '../../shared/schema'

export async function verifyImage(dataUrl: string, expected?: { width: number; height: number }): Promise<void> {
  const comma = dataUrl.indexOf(',')
  const raw = atob(dataUrl.slice(comma + 1))
  const bytes = Uint8Array.from(raw, character => character.charCodeAt(0))
  const bitmap = await createImageBitmap(new Blob([bytes], { type: dataUrl.slice(5, dataUrl.indexOf(';')) }))
  try {
    if (bitmap.width > 8192 || bitmap.height > 8192 || bitmap.width * bitmap.height > 16_777_216) throw new Error('Image exceeds the supported dimensions. Crop to the Fate panel first.')
    if (expected && (bitmap.width !== expected.width || bitmap.height !== expected.height)) throw new Error('Capture image dimensions do not match its metadata.')
  } finally { bitmap.close() }
}

export type EvidenceRead = { evidence: Evidence | null; status: 'available' | 'missing' | 'damaged'; warning: string | null }
export async function inspectEvidence(raw: unknown, decode = false): Promise<EvidenceRead> {
  if (raw === undefined || raw === null) return { evidence: null, status: 'missing', warning: null }
  const parsed = evidenceSchema.safeParse(raw)
  if (parsed.success) {
    try {
      if (decode) await verifyImage(parsed.data.imageDataUrl)
      return { evidence: parsed.data, status: 'available', warning: null }
    } catch { /* Preserve the raw record; a failed image must not block the offer. */ }
  }
  return { evidence: null, status: 'damaged', warning: 'The original screenshot or OCR is damaged. Offer details are still available. Export recovery data, or restore evidence from the original capture.' }
}
