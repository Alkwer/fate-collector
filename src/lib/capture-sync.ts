import { MAX_IMPORT_BYTES, type Evidence, type Offer } from '../../shared/schema'
import { importJson } from './imports'
import { captureRestoreVersion, handledCaptureIds, hasCaptureReceipt, receiveCapture } from './storage'

export type CaptureDirectory = FileSystemDirectoryHandle & {
  queryPermission(options: { mode: 'read' }): Promise<PermissionState>
  requestPermission(options: { mode: 'read' }): Promise<PermissionState>
}
export type CapturedEntry = { offer: Offer; evidence: Evidence; restored?: boolean; present?: boolean }
export function compareCaptures(a: Offer, b: Offer): number {
  const left = a.captureContext?.session, right = b.captureContext?.session
  if (left && right && left.id === right.id && left.sequence !== right.sequence) return left.sequence - right.sequence
  return Date.parse(a.capturedAt) - Date.parse(b.capturedAt) || a.id.localeCompare(b.id)
}
export const captureName = /^fate-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/i
export function directoryPicker() {
  return (window as Window & { showDirectoryPicker?: (options: { id: string; mode: 'read' }) => Promise<CaptureDirectory> }).showDirectoryPicker
}

export class CaptureReader {
  private handled = new Set<string>()
  private invalid = new Map<string, { stamp: string; error: string }>()
  private restoreVersion: string | undefined
  private latestPresented: Offer | undefined

  async scan(folder: CaptureDirectory, onSaved: (entry: CapturedEntry) => Promise<void>, stopped: () => boolean) {
    if (await folder.queryPermission({ mode: 'read' }) !== 'granted') throw new DOMException('Allow access to the capture folder to resume.', 'NotAllowedError')
    const version = await captureRestoreVersion()
    if (version !== this.restoreVersion) { this.handled = await handledCaptureIds(); this.restoreVersion = version }
    const present = new Set<string>()
    for await (const handle of folder.values()) {
      if (stopped()) break
      const match = handle.kind === 'file' && handle.name.match(captureName)
      if (!match) continue
      const id = match[1].toLowerCase()
      present.add(id)
      if (this.handled.has(id)) continue
      if (await hasCaptureReceipt(id)) { this.handled.add(id); continue }
      let file: File
      try { file = await (handle as FileSystemFileHandle).getFile() }
      catch (error) { if (error instanceof DOMException && error.name === 'NotFoundError') continue; throw error }
      const stamp = `${file.lastModified}:${file.size}`
      if (this.invalid.get(id)?.stamp === stamp) continue
      let entry: CapturedEntry
      try {
        if (file.size > MAX_IMPORT_BYTES) throw new Error('Capture exceeds 12 MiB.')
        const result = await importJson(await file.text(), true)
        const parsed = result.entries[0]
        if (!parsed.evidence || parsed.offer.id !== id) throw new Error('Capture ID does not match the filename.')
        entry = { offer: parsed.offer, evidence: parsed.evidence }
      } catch (error) {
        this.invalid.set(id, { stamp, error: `${handle.name}: ${error instanceof Error ? error.message : 'Invalid capture.'}` })
        continue
      }
      if (stopped()) break
      // One transaction handles duplicates across tabs and protects existing corrections.
      const delivery = await receiveCapture(entry.offer, entry.evidence)
      this.handled.add(id); this.invalid.delete(id)
      if (delivery.status !== 'unchanged' && delivery.offer) {
        const present = !this.latestPresented || compareCaptures(delivery.offer, this.latestPresented) > 0
        if (present) this.latestPresented = delivery.offer
        await onSaved({ ...entry, offer: delivery.offer, restored: delivery.status === 'restored', present })
      }
    }
    for (const id of this.invalid.keys()) if (!present.has(id)) this.invalid.delete(id)
    return { invalidCount: this.invalid.size, problem: this.invalid.values().next().value?.error ?? null }
  }
}
