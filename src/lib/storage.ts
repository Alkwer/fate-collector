import { z } from 'zod'
import { evidenceSchema, offerSchema, type Evidence, type Offer } from '../../shared/schema'

const recordSchema = z.object({ offer: offerSchema, uploadedRevision: z.number().int().nullable(), uploadedAt: z.string().nullable(), uploadedConsentId: z.string().uuid().optional() }).strict()
export type SavedOffer = z.infer<typeof recordSchema>
const DB_NAME = 'fate-collector'
let connection: Promise<IDBDatabase> | undefined
function db(): Promise<IDBDatabase> {
  if (!connection) connection = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2)
    request.onupgradeneeded = () => {
      for (const [name, keyPath] of [['offers', 'offer.id'], ['evidence', 'id'], ['captureReceipts', 'id'], ['settings', 'id']]) {
        if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath })
      }
    }
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); connection = undefined }; resolve(request.result) }
    request.onerror = () => { connection = undefined; reject(new Error('Browser storage could not be opened. Export your draft before closing this page.')) }
    request.onblocked = () => { connection = undefined; reject(new Error('Close other Fate Collector tabs and retry.')) }
  })
  return connection
}
function value<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
}
function complete(transaction: IDBTransaction): Promise<void> {
  const result = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(new Error('The browser could not save this offer. Free storage or export your draft.'))
    transaction.onabort = () => reject(new Error('The save was interrupted. Your draft is still open.'))
  })
  // A request may reject before its transaction does; keep the later rejection handled.
  void result.catch(() => {})
  return result
}
export async function listOffers(): Promise<SavedOffer[]> {
  const database = await db()
  const records: unknown[] = await value(database.transaction('offers').objectStore('offers').getAll())
  return records.map(r => recordSchema.parse(r)).sort((a, b) => b.offer.updatedAt.localeCompare(a.offer.updatedAt))
}
export async function getOffer(id: string): Promise<SavedOffer | undefined> {
  const database = await db()
  const record: unknown = await value(database.transaction('offers').objectStore('offers').get(id))
  return record ? recordSchema.parse(record) : undefined
}
export async function getEvidence(id: string | null): Promise<Evidence | null> {
  if (!id) return null
  const database = await db()
  const record: unknown = await value(database.transaction('evidence').objectStore('evidence').get(id))
  return record ? evidenceSchema.parse(record) : null
}
async function addMissingEvidence(store: IDBObjectStore, evidence: Evidence): Promise<boolean> {
  if (await value(store.get(evidence.id))) return false
  store.put(evidence)
  return true
}
export async function restoreEvidence(offerId: string, evidence: Evidence): Promise<boolean> {
  evidence = evidenceSchema.parse(evidence)
  const transaction = (await db()).transaction(['offers', 'evidence'], 'readwrite')
  const done = complete(transaction)
  const record = await value(transaction.objectStore('offers').get(offerId)) as SavedOffer | undefined
  if (!record || record.offer.captureId !== evidence.id) {
    transaction.abort(); await done.catch(() => {})
    throw new Error('Evidence does not belong to the saved offer.')
  }
  const restored = await addMissingEvidence(transaction.objectStore('evidence'), evidence)
  await done
  return restored
}
export async function saveOffer(draft: Offer, evidence: Evidence | null): Promise<SavedOffer> {
  draft = offerSchema.parse(draft)
  evidence = evidence ? evidenceSchema.parse(evidence) : null
  if (evidence && evidence.id !== draft.captureId) throw new Error('Evidence does not belong to this offer.')
  const database = await db()
  const transaction = database.transaction(['offers', 'evidence'], 'readwrite')
  const done = complete(transaction)
  const store = transaction.objectStore('offers')
  const existing = await value(store.get(draft.id)) as SavedOffer | undefined
  const count = await value(store.count())
  if (!existing && count >= 250) { transaction.abort(); await done.catch(() => {}); throw new Error('Local storage is limited to 250 offers. Export and remove older offers first.') }
  const offer = offerSchema.parse({ ...draft, revision: existing ? Math.max(existing.offer.revision + 1, draft.revision) : draft.revision, updatedAt: new Date().toISOString() })
  const record = { offer, uploadedRevision: existing?.uploadedRevision ?? null, uploadedAt: existing?.uploadedAt ?? null, ...(existing?.uploadedConsentId ? { uploadedConsentId: existing.uploadedConsentId } : {}) }
  store.put(record)
  if (evidence) await addMissingEvidence(transaction.objectStore('evidence'), evidence)
  await done
  return record
}
export async function importOffers(entries: { offer: Offer; evidence: Evidence | null }[]): Promise<number> {
  const parsed = entries.map(entry => {
    const offer = offerSchema.parse(entry.offer)
    const evidence = entry.evidence ? evidenceSchema.parse(entry.evidence) : null
    if (evidence && evidence.id !== offer.captureId) throw new Error('Evidence does not belong to this offer.')
    return { offer, evidence }
  })
  const database = await db()
  const transaction = database.transaction(['offers', 'evidence'], 'readwrite')
  const done = complete(transaction)
  const store = transaction.objectStore('offers')
  const existingIds = new Set(await value(store.getAllKeys()))
  const newEntries = parsed.filter(entry => {
    if (existingIds.has(entry.offer.id)) return false
    existingIds.add(entry.offer.id)
    return true
  })
  if (existingIds.size > 250) {
    transaction.abort(); await done.catch(() => {})
    throw new Error('This import would exceed 250 local offers. Nothing was imported. Export and remove older offers first.')
  }
  for (const { offer } of newEntries) {
    store.put({ offer, uploadedRevision: null, uploadedAt: null })
  }
  // A metadata backup may already contain the offer but lack its image. Restore
  // only missing evidence for the saved capture reference; never replace edits.
  for (const { offer, evidence } of parsed) {
    if (!evidence) continue
    const saved = await value(store.get(offer.id)) as SavedOffer
    if (saved.offer.captureId === evidence.id) await addMissingEvidence(transaction.objectStore('evidence'), evidence)
  }
  await done
  return newEntries.length
}
export async function markUploaded(id: string, revision: number, consentId?: string): Promise<void> {
  const database = await db()
  const transaction = database.transaction('offers', 'readwrite')
  const done = complete(transaction)
  const store = transaction.objectStore('offers')
  const record = await value(store.get(id)) as SavedOffer | undefined
  if (record) store.put({ ...record, uploadedRevision: Math.max(record.uploadedRevision ?? 0, revision), uploadedAt: new Date().toISOString(), ...(consentId ? { uploadedConsentId: consentId } : {}) })
  await done
}
export async function deleteOffer(id: string): Promise<void> {
  const database = await db()
  const transaction = database.transaction(['offers', 'evidence', 'captureReceipts'], 'readwrite')
  const done = complete(transaction)
  const store = transaction.objectStore('offers')
  const record = await value(store.get(id)) as SavedOffer | undefined
  store.delete(id)
  if (record?.offer.captureId) {
    // Retain a receipt so folder sync does not resurrect deliberately deleted captures.
    transaction.objectStore('captureReceipts').put({ id: record.offer.captureId })
    const remaining = await value(store.getAll()) as SavedOffer[]
    if (!remaining.some(r => r.offer.captureId === record.offer.captureId)) transaction.objectStore('evidence').delete(record.offer.captureId)
  }
  await done
}

export async function hasCaptureReceipt(id: string): Promise<boolean> {
  const transaction = (await db()).transaction(['offers', 'evidence', 'captureReceipts'])
  if (!await value(transaction.objectStore('captureReceipts').get(id))) return false
  const saved = await value(transaction.objectStore('offers').get(id)) as SavedOffer | undefined
  // A deleted offer stays deleted. Explicitly restored metadata can recover its
  // missing image when the original helper file is encountered again.
  if (!saved || saved.offer.captureId !== id) return true
  return !!await value(transaction.objectStore('evidence').get(id))
}

export async function receiveCapture(offer: Offer, evidence: Evidence): Promise<boolean> {
  offer = offerSchema.parse({ ...offer, reviewed: false, completeness: 'unverified' })
  evidence = evidenceSchema.parse(evidence)
  if (offer.id !== evidence.id || offer.captureId !== evidence.id || offer.source !== 'windows-helper') throw new Error('Invalid helper capture.')
  const transaction = (await db()).transaction(['offers', 'evidence', 'captureReceipts'], 'readwrite')
  const done = complete(transaction)
  const receipts = transaction.objectStore('captureReceipts')
  const offers = transaction.objectStore('offers')
  const existing = await value(offers.get(offer.id)) as SavedOffer | undefined
  if (existing) {
    if (existing.offer.captureId === evidence.id) await addMissingEvidence(transaction.objectStore('evidence'), evidence)
    receipts.put({ id: offer.id }); await done; return false
  }
  if (await value(receipts.get(offer.id))) { await done; return false }
  if (await value(offers.count()) >= 250) {
    transaction.abort(); await done.catch(() => {})
    throw new Error('Auto-save paused: 250 offers stored. Export and remove older offers, then resume. New captures remain in the helper folder.')
  }
  offers.put({ offer, uploadedRevision: null, uploadedAt: null })
  transaction.objectStore('evidence').put(evidence)
  receipts.put({ id: offer.id })
  await done
  return true
}

export async function getCaptureFolder(): Promise<FileSystemDirectoryHandle | null> {
  const record = await value((await db()).transaction('settings').objectStore('settings').get('capture-folder')) as { handle: FileSystemDirectoryHandle } | undefined
  return record?.handle ?? null
}
export async function setCaptureFolder(handle: FileSystemDirectoryHandle | null): Promise<void> {
  const transaction = (await db()).transaction('settings', 'readwrite')
  const done = complete(transaction)
  if (handle) transaction.objectStore('settings').put({ id: 'capture-folder', handle })
  else transaction.objectStore('settings').delete('capture-folder')
  await done
}
