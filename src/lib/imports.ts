import { captureSchema, exportSchema, offerSchema, MAX_IMPORT_BYTES, formatValidationError, type Evidence, type Offer, type Archive } from '../../shared/schema'
import { captureToDraft, newOffer } from '../../shared/offers'
import { extractCards } from '../../shared/recognition'
import { applyVisualSuggestions } from '../../shared/visual-suggestions'
import { readVisualCapture } from './visual-recognition'

export interface Imported { mode: 'draft' | 'restore'; entries: { offer: Offer; evidence: Evidence | null }[]; message: string }
export async function verifyImage(dataUrl: string, expected?: { width: number; height: number }): Promise<void> {
  const comma = dataUrl.indexOf(',')
  const raw = atob(dataUrl.slice(comma + 1))
  const bytes = Uint8Array.from(raw, character => character.charCodeAt(0))
  const blob = new Blob([bytes], { type: dataUrl.slice(5, dataUrl.indexOf(';')) })
  const bitmap = await createImageBitmap(blob)
  try {
    if (bitmap.width > 8192 || bitmap.height > 8192 || bitmap.width * bitmap.height > 16_777_216) throw new Error('Image exceeds the supported dimensions. Crop to the Fate panel first.')
    if (expected && (bitmap.width !== expected.width || bitmap.height !== expected.height)) throw new Error('Capture image dimensions do not match its metadata.')
  } finally { bitmap.close() }
}
export async function importJson(text: string, captureOnly = false): Promise<Imported> {
  if (new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES) throw new Error('Import exceeds 12 MiB. Use a tighter screenshot crop or a smaller export.')
  let body: unknown
  try { body = JSON.parse(text.replace(/^\uFEFF/, '')) } catch { throw new Error('This is not a valid JSON file.') }
  const kind = typeof body === 'object' && body !== null && 'kind' in body ? body.kind : null
  if (captureOnly && kind !== 'fate-collector.capture') throw new Error('Auto-import accepts helper captures only.')
  if (kind === 'fate-collector.capture') {
    const parsed = captureSchema.safeParse(body)
    if (!parsed.success) throw new Error(formatValidationError(parsed.error))
    const entry = captureToDraft(parsed.data)
    await verifyImage(entry.evidence.imageDataUrl, parsed.data.image)
    const recognition = extractCards(parsed.data)
    const visual = recognition.cards.length ? await readVisualCapture(parsed.data) : null
    entry.offer.cards = visual ? applyVisualSuggestions(recognition.cards, parsed.data, visual) : recognition.cards
    if (visual) entry.evidence.visualRecognition = { version: visual.version, status: visual.status, warnings: visual.warnings }
    const suggested = entry.offer.cards.some(card => card.visualReview)
    return { mode: 'draft', entries: [entry], message: suggested
      ? `${entry.offer.cards.length} candidate cards found. Check suggested tiers and rewards against the image and tooltips; the catalog covers only some icons.`
      : recognition.message }
  }
  if (kind === 'fate-collector.offer') {
    const parsed = offerSchema.safeParse(body)
    if (!parsed.success) throw new Error(formatValidationError(parsed.error))
    return { mode: 'restore', entries: [{ offer: parsed.data, evidence: null }], message: 'Offer read from the backup.' }
  }
  const parsed = exportSchema.safeParse(body)
  if (!parsed.success) throw new Error(kind === 'fate-collector.export' ? formatValidationError(parsed.error) : 'Unsupported file. Use a Fate Collector capture or export.')
  for (const entry of parsed.data.offers) if (entry.evidence) await verifyImage(entry.evidence.imageDataUrl)
  return { mode: 'restore', entries: parsed.data.offers, message: `${parsed.data.offers.length} offer(s) read from the export.` }
}
export async function importFile(file: File): Promise<Imported> {
  if (file.size > MAX_IMPORT_BYTES) throw new Error('File exceeds 12 MiB. Crop the screenshot to the Fate panel.')
  if (file.type === 'image/png' || file.type === 'image/jpeg') {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new Error('The image could not be read.'))
      reader.readAsDataURL(file)
    })
    if (dataUrl.length > MAX_IMPORT_BYTES) throw new Error('The encoded image exceeds 12 MiB. Use a smaller crop.')
    await verifyImage(dataUrl)
    const offer = newOffer()
    offer.source = 'screenshot'
    offer.captureId = offer.id
    return { mode: 'draft', entries: [{ offer, evidence: { id: offer.id, imageDataUrl: dataUrl, ocrText: '', ocrLines: [], ocrStatus: 'not-run', helperVersion: null } }],
      message: 'Screenshot preserved. Use the Windows helper to read card text automatically, or save this capture for later.' }
  }
  return importJson(await file.text())
}
export function downloadArchive(entries: Archive['offers'], filename = 'fate-collector-export.json'): void {
  const archive = exportSchema.parse({ kind: 'fate-collector.export', schemaVersion: 1, offers: entries })
  const json = JSON.stringify(archive, null, 2)
  if (new TextEncoder().encode(json).byteLength > MAX_IMPORT_BYTES) throw new Error('Export exceeds 12 MiB. Export without images from Saved offers.')
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url; link.download = filename; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Every part uses the existing import contract; a large journal never requires
// raising the decoder limit or opening each individual offer to back it up.
export function archiveParts(entries: Archive['offers']): { filename: string; json: string; offers: number }[] {
  const archive = exportSchema.parse({ kind: 'fate-collector.export', schemaVersion: 1, offers: entries })
  const prefix = '{"kind":"fate-collector.export","schemaVersion":1,"offers":['
  const suffix = ']}'
  const encoder = new TextEncoder()
  const overhead = encoder.encode(prefix + suffix).byteLength
  const parts: { filename: string; json: string; offers: number }[] = []
  let values: string[] = [], size = overhead
  const flush = () => {
    parts.push({ filename: `fate-collector-data-${String(parts.length + 1).padStart(3, '0')}.json`, json: prefix + values.join(',') + suffix, offers: values.length })
    values = []; size = overhead
  }
  for (const entry of archive.offers) {
    const text = JSON.stringify(entry)
    const bytes = encoder.encode(text).byteLength
    if (bytes + overhead > MAX_IMPORT_BYTES) throw new Error('One offer exceeds the backup part limit. Export its metadata separately from its evidence.')
    if (size + bytes + (values.length ? 1 : 0) > MAX_IMPORT_BYTES) flush()
    size += bytes + (values.length ? 1 : 0); values.push(text)
  }
  if (values.length) flush()
  return parts
}
