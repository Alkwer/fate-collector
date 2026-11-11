import { captureSchema, exportSchema, offerSchema, MAX_IMPORT_BYTES, MAX_ARCHIVE_BYTES, formatValidationError, type Evidence, type Offer, type Archive } from '../../shared/schema'
import { captureToDraft, newOffer } from '../../shared/offers'
import { extractCards, findOfferedRegion, knownFateName } from '../../shared/recognition'
import { applyVisualSuggestions } from '../../shared/visual-suggestions'
import { readVisualCapture } from './visual-recognition'
import { verifyImage } from './evidence'
import { combineBackupParts } from '../../shared/backups'
import { evidenceSchema } from '../../shared/schema'
export { verifyImage } from './evidence'

export interface Imported { mode: 'draft' | 'restore'; entries: { offer: Offer; evidence: Evidence | null }[]; message: string }
export async function importJson(text: string, captureOnly = false): Promise<Imported> {
  const bytes = new TextEncoder().encode(text).byteLength
  if (bytes > MAX_ARCHIVE_BYTES) throw new Error('Backup exceeds 32 MiB. Import each exported part separately.')
  let body: unknown
  try { body = JSON.parse(text.replace(/^\uFEFF/, '')) } catch { throw new Error('This is not a valid JSON file.') }
  const kind = typeof body === 'object' && body !== null && 'kind' in body ? body.kind : null
  if (bytes > MAX_IMPORT_BYTES && kind !== 'fate-collector.export') throw new Error('Import exceeds 12 MiB. Use a tighter screenshot crop.')
  if (captureOnly && kind !== 'fate-collector.capture') throw new Error('Auto-import accepts helper captures only.')
  if (kind === 'fate-collector.capture') {
    const parsed = captureSchema.safeParse(body)
    if (!parsed.success) throw new Error(formatValidationError(parsed.error))
    const entry = captureToDraft(parsed.data)
    await verifyImage(entry.evidence.imageDataUrl, parsed.data.image)
    const recognition = extractCards(parsed.data)
    const visual = recognition.cards.length ? await readVisualCapture(parsed.data) : null
    entry.offer.cards = visual ? applyVisualSuggestions(recognition.cards, parsed.data, visual) : recognition.cards
    const region = findOfferedRegion(parsed.data)
    if (region) {
      const headers = region.headers.filter(header => knownFateName(header.text))
      if (headers.length === entry.offer.cards.length) entry.evidence.cardRegions = headers.map((header, index) => {
        const center = header.x + header.width / 2
        const previous = headers[index - 1], next = headers[index + 1]
        const left = previous ? (previous.x + previous.width / 2 + center) / 2 : Math.max(0, header.x - header.width / 2)
        const right = next ? (next.x + next.width / 2 + center) / 2 : Math.min(parsed.data.image.width, header.x + header.width * 1.5)
        return { cardId: entry.offer.cards[index].id, x: left / parsed.data.image.width, y: header.y / parsed.data.image.height,
          width: (right - left) / parsed.data.image.width, height: (region.bottom - header.y) / parsed.data.image.height }
      })
    }
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
  const part = parsed.data.backup
  return { mode: 'restore', entries: parsed.data.offers, message: part && part.total > 1
    ? `Backup part ${part.part} of ${part.total}. Import the remaining parts to restore the whole set.`
    : `${parsed.data.offers.length} offer(s) read from the export.` }
}
export async function importFiles(files: File[]): Promise<Imported> {
  if (files.length === 1) return importFile(files[0])
  if (!files.length || files.length > 250 || files.reduce((sum, file) => sum + file.size, 0) > 512 * 1024 * 1024) throw new Error('Select up to 250 backup parts and 512 MiB at once. Larger sets can be restored one part at a time.')
  const archives: Archive[] = []
  for (const file of files) {
    if (file.size > MAX_ARCHIVE_BYTES) throw new Error('A backup part exceeds 32 MiB.')
    const text = await file.text()
    await importJson(text) // Validate image bytes before any storage mutation.
    archives.push(exportSchema.parse(JSON.parse(text.replace(/^\uFEFF/, ''))))
  }
  const archive = combineBackupParts(archives)
  return { mode: 'restore', entries: archive.offers, message: `Complete backup set read from ${files.length} files.` }
}

export async function recoverBackup(file: File): Promise<Imported> {
  if (file.size > MAX_ARCHIVE_BYTES) throw new Error('Recovery input exceeds 32 MiB. Use one backup part at a time.')
  const body = JSON.parse((await file.text()).replace(/^\uFEFF/, ''))
  if (body?.kind !== 'fate-collector.export' || body.schemaVersion !== 1 || !Array.isArray(body.offers) || body.offers.length > 250) throw new Error('Choose an offer backup part. Raw recovery exports need manual repair before importing.')
  const entries: Imported['entries'] = []
  let skipped = 0, omittedEvidence = 0
  for (const raw of body.offers) {
    const offer = offerSchema.safeParse(raw?.offer)
    if (!offer.success) { skipped++; continue }
    let evidence: Evidence | null = null
    if (raw.evidence !== null && raw.evidence !== undefined) {
      const parsed = evidenceSchema.safeParse(raw.evidence)
      if (parsed.success && parsed.data.id === offer.data.captureId) {
        try { await verifyImage(parsed.data.imageDataUrl); evidence = parsed.data } catch { /* Explicit salvage preserves readable offer fields. */ }
      }
      if (!evidence) omittedEvidence++
    }
    entries.push({ offer: offer.data, evidence })
  }
  if (!entries.length) throw new Error('No valid offer data could be recovered. Keep the original file for manual repair.')
  return { mode: 'restore', entries, message: `Recovered ${entries.length} readable offers; skipped ${skipped} invalid offers and ${omittedEvidence} damaged evidence records. Keep the original file for further recovery.` }
}
export async function importFile(file: File): Promise<Imported> {
  if (file.size > MAX_ARCHIVE_BYTES) throw new Error('File exceeds 32 MiB. Import each exported backup part separately.')
  if (file.type === 'image/png' || file.type === 'image/jpeg') {
    if (file.size > MAX_IMPORT_BYTES) throw new Error('Image exceeds 12 MiB. Crop the screenshot to the Fate panel.')
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
  if (new TextEncoder().encode(json).byteLength > MAX_ARCHIVE_BYTES) throw new Error('Export exceeds 32 MiB. Use the multipart backup from Saved offers.')
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url; link.download = filename; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export type BackupPart = { filename: string; blob: Blob; offers: number }

// Serialize one bounded part at a time. Screenshot strings from earlier parts
// are released while the browser retains their downloadable blobs.
export function createBackupParts(includeEvidence: boolean) {
  const prefix = '{"kind":"fate-collector.export","schemaVersion":1,"offers":['
  const suffix = ']}'
  const setId = crypto.randomUUID()
  const encoder = new TextEncoder(), overhead = encoder.encode(prefix + suffix).byteLength + 160
  const parts: BackupPart[] = []
  let values: string[] = [], size = overhead
  const flush = () => {
    if (!values.length) return
    parts.push({ filename: `fate-collector-${includeEvidence ? 'full' : 'data'}-${String(parts.length + 1).padStart(3, '0')}.json`,
      blob: new Blob([prefix, values.join(','), suffix], { type: 'application/json' }), offers: values.length })
    values = []; size = overhead
  }
  return {
    add(entry: Archive['offers'][number]) {
      const checked = exportSchema.parse({ kind: 'fate-collector.export', schemaVersion: 1, offers: [entry] }).offers[0]
      const text = JSON.stringify(checked), bytes = encoder.encode(text).byteLength
      if (bytes + overhead > MAX_ARCHIVE_BYTES) throw new Error('One offer exceeds the 32 MiB backup limit. Its original data is unchanged.')
      if (size + bytes + (values.length ? 1 : 0) > MAX_IMPORT_BYTES) flush()
      values.push(text); size += bytes + (values.length > 1 ? 1 : 0)
      if (size > MAX_IMPORT_BYTES) flush()
    },
    finish() {
      flush()
      return parts.map((part, index) => ({ ...part,
        filename: part.filename.replace(/-(\d+)\.json$/, `-${setId}-$1.json`),
        blob: new Blob([`{"kind":"fate-collector.export","schemaVersion":1,"backup":${JSON.stringify({ setId, part: index + 1, total: parts.length })},"offers":[`, part.blob.slice(prefix.length)], { type: 'application/json' }),
      }))
    },
  }
}
