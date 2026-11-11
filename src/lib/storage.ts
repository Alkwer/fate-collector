import { z } from 'zod'
import { evidenceSchema, offerSchema, type Archive, type Evidence, type Offer } from '../../shared/schema'
import { sharingConsent } from './consent'
import { inspectEvidence, verifyImage } from './evidence'

const changedEvent = 'fate-collector-history-changed'
function changed() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(changedEvent))
  try { const channel = new BroadcastChannel(changedEvent); channel.postMessage('changed'); channel.close() } catch { /* Focus refresh remains available. */ }
}
export function onHistoryChange(listener: () => void) {
  let channel: BroadcastChannel | undefined
  try { channel = new BroadcastChannel(changedEvent); channel.onmessage = listener } catch { /* Older browsers refresh on focus. */ }
  window.addEventListener(changedEvent, listener); window.addEventListener('focus', listener)
  return () => { channel?.close(); window.removeEventListener(changedEvent, listener); window.removeEventListener('focus', listener) }
}

const recordSchema = z.object({ offer: offerSchema, uploadedRevision: z.number().int().nullable(), uploadedAt: z.string().nullable(), uploadedConsentId: z.string().uuid().optional() }).strict()
export type SavedOffer = z.infer<typeof recordSchema>
export type UnreadableOffer = { key: IDBValidKey; problems: string[] }
export class OfferRevisionConflictError extends Error {
  constructor(message = 'This offer changed in another tab. Your draft is still open. Export it to keep your edits, then reopen the offer from Saved offers.') {
    super(message)
    this.name = 'OfferRevisionConflictError'
  }
}
export class OfferDeletedError extends OfferRevisionConflictError {
  constructor() {
    super('This offer was deleted in another tab. Your draft is still open. Export it to keep your edits; import that backup explicitly to restore it.')
    this.name = 'OfferDeletedError'
  }
}
const DB_NAME = 'fate-collector'
let connection: Promise<IDBDatabase> | undefined
function db(): Promise<IDBDatabase> {
  if (!connection) connection = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 3)
    request.onupgradeneeded = () => {
      for (const [name, keyPath] of [['offers', 'offer.id'], ['evidence', 'id'], ['captureReceipts', 'id'], ['settings', 'id'], ['deletedOffers', 'id']]) {
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
async function storedKeys(store: IDBObjectStore, id: string): Promise<IDBValidKey[]> {
  const key = id.toLowerCase()
  return (await value(store.getAllKeys())).filter(item => typeof item === 'string' && item.toLowerCase() === key)
}
async function storedKey(store: IDBObjectStore, id: string): Promise<IDBValidKey> {
  const matches = await storedKeys(store, id)
  if (matches.length > 1) {
    // Callers may already have queued writes in this transaction. A rejected
    // JavaScript promise alone does not roll those IndexedDB writes back.
    if (store.transaction.mode === 'readwrite') store.transaction.abort()
    throw new Error('Conflicting historical identifiers need recovery before this record can be changed.')
  }
  return matches[0] ?? id.toLowerCase()
}
async function readStoredEvidence(store: IDBObjectStore, id: string, decode: boolean): ReturnType<typeof inspectEvidence> {
  const matches = await storedKeys(store, id)
  if (matches.length > 1) return { evidence: null, status: 'damaged', warning: 'Conflicting historical screenshots or OCR need recovery. Offer details are still available. Export recovery data, or restore evidence from the original capture.' }
  return inspectEvidence(matches.length ? await value(store.get(matches[0])) : undefined, decode)
}
function decodeOffers(raw: unknown[], keys: IDBValidKey[]) {
  const records: SavedOffer[] = [], unreadable: UnreadableOffer[] = []
  raw.forEach((record, index) => {
    if (keys.filter(key => String(key).toLowerCase() === String(keys[index]).toLowerCase()).length > 1) {
      unreadable.push({ key: keys[index], problems: ['Conflicting historical identifiers. Export recovery data and isolate one original before editing.'] }); return
    }
    const parsed = recordSchema.safeParse(record)
    if (parsed.success) records.push(parsed.data)
    else unreadable.push({ key: keys[index], problems: parsed.error.issues.slice(0, 3).map(issue => `${issue.path.join('.')}: ${issue.message}`) })
  })
  return { records: records.sort((a, b) => b.offer.updatedAt.localeCompare(a.offer.updatedAt)), unreadable }
}
export async function readOfferHistory() {
  const transaction = (await db()).transaction(['offers', 'evidence', 'settings']), store = transaction.objectStore('offers')
  const [raw, keys, evidenceKeys, settingsKeys] = await Promise.all([value(store.getAll()) as Promise<unknown[]>, value(store.getAllKeys()),
    value(transaction.objectStore('evidence').getAllKeys()), value(transaction.objectStore('settings').getAllKeys())])
  const history = decodeOffers(raw, keys), images = new Set(evidenceKeys.map(key => String(key).toLowerCase()))
  return { ...history, missingEvidenceIds: history.records.filter(({ offer }) => offer.captureId && !images.has(offer.captureId)).map(({ offer }) => offer.id),
    isolatedCount: settingsKeys.filter(key => String(key).startsWith('recovery-')).length }
}
export async function listOffers(): Promise<SavedOffer[]> {
  return (await readOfferHistory()).records
}

// Read each offer and its immutable evidence together, then decode outside IDB.
// Image decoding must never leave an IndexedDB transaction waiting on external work.
export async function readOfferArchive(includeEvidence: boolean, onEntry: (entry: Archive['offers'][number]) => void) {
  const database = await db()
  const keys = await value(database.transaction('offers').objectStore('offers').getAllKeys())
  let offers = 0, omittedOffers = 0, missingEvidence = 0, damagedEvidence = 0
  for (const key of keys) {
    if (keys.filter(item => String(item).toLowerCase() === String(key).toLowerCase()).length > 1) { omittedOffers++; continue }
    const transaction = database.transaction(['offers', 'evidence'])
    const parsed = recordSchema.safeParse(await value(transaction.objectStore('offers').get(key)))
    if (!parsed.success) { omittedOffers++; continue }
    const { offer } = parsed.data
    let evidence: Evidence | null = null
    if (includeEvidence && offer.captureId) {
      const store = transaction.objectStore('evidence')
      const read = await readStoredEvidence(store, offer.captureId, true)
      evidence = read.evidence
      if (read.status === 'missing') missingEvidence++
      if (read.status === 'damaged') damagedEvidence++
    }
    onEntry({ offer, evidence })
    offers++
  }
  return { offers, omittedOffers, missingEvidence, damagedEvidence }
}

// This forensic export deliberately has a different kind from importable backups.
// Keep the original invalid records and any associated evidence untouched.
export async function readOfferRecovery() {
  const database = await db()
  const transaction = database.transaction(['offers', 'evidence', 'settings'])
  const offers = transaction.objectStore('offers'), evidence = transaction.objectStore('evidence')
  const [raw, keys, settings] = await Promise.all([
    value(offers.getAll()) as Promise<unknown[]>, value(offers.getAllKeys()),
    value(transaction.objectStore('settings').getAll()) as Promise<{ id: string; key: IDBValidKey; value: unknown }[]>,
  ])
  const isolated = settings.filter(record => record.id.startsWith('recovery-'))
  const { unreadable } = decodeOffers(raw, keys)
  const damagedIndexes = raw.map((_, index) => unreadable.some(record => record.key === keys[index]) ? index : -1).filter(index => index >= 0)
  const recoveryOffers = [...damagedIndexes.map(index => raw[index]), ...isolated.filter(record => record.id.startsWith('recovery-offer:')).map(record => record.value)]
  const captureIds = new Set(recoveryOffers.flatMap(entry => {
    const record = entry as { offer?: { captureId?: unknown } } | null
    return typeof record?.offer?.captureId === 'string' ? [record.offer.captureId.toLowerCase()] : []
  }))
  const evidenceKeys = await value(evidence.getAllKeys())
  const damagedEvidence: { key: IDBValidKey; value: unknown }[] = []
  for (const key of evidenceKeys) {
    const entry = { key, value: await value(database.transaction('evidence').objectStore('evidence').get(key)) as unknown }
    const collision = evidenceKeys.filter(item => String(item).toLowerCase() === String(key).toLowerCase()).length > 1
    if (collision || captureIds.has(String(entry.key).toLowerCase()) || (await inspectEvidence(entry.value, true)).status === 'damaged') damagedEvidence.push(entry)
  }
  return { kind: 'fate-collector.recovery', schemaVersion: 1, exportedAt: new Date().toISOString(),
    records: damagedIndexes.map((index, position) => ({ key: keys[index], value: raw[index], problems: unreadable[position].problems })),
    evidence: damagedEvidence, isolated,
  }
}
export async function getOffer(id: string): Promise<SavedOffer | undefined> {
  const database = await db()
  const store = database.transaction('offers').objectStore('offers')
  const record: unknown = await value(store.get(await storedKey(store, id)))
  return record ? recordSchema.parse(record) : undefined
}
export async function readEvidence(id: string | null, decode = false) {
  if (!id) return inspectEvidence(undefined)
  const store = (await db()).transaction('evidence').objectStore('evidence')
  return readStoredEvidence(store, id, decode)
}
export async function getEvidence(id: string | null): Promise<Evidence | null> {
  return (await readEvidence(id)).evidence
}
async function addMissingEvidence(store: IDBObjectStore, evidence: Evidence): Promise<boolean> {
  if (await value(store.get(await storedKey(store, evidence.id)))) return false
  store.put(evidence)
  return true
}
export async function restoreEvidence(offerId: string, evidence: Evidence): Promise<boolean> {
  evidence = evidenceSchema.parse(evidence)
  const transaction = (await db()).transaction(['offers', 'evidence'], 'readwrite')
  const done = complete(transaction)
  const offers = transaction.objectStore('offers')
  const record = await value(offers.get(await storedKey(offers, offerId))) as SavedOffer | undefined
  if (!record || record.offer.captureId?.toLowerCase() !== evidence.id) {
    transaction.abort(); await done.catch(() => {})
    throw new Error('Evidence does not belong to the saved offer.')
  }
  const restored = await addMissingEvidence(transaction.objectStore('evidence'), evidence)
  await done
  if (restored) changed()
  return restored
}
// Explicit repair only: keep the exact damaged original in recovery storage.
export async function repairEvidence(offerId: string, evidence: Evidence): Promise<void> {
  evidence = evidenceSchema.parse(evidence)
  await verifyImage(evidence.imageDataUrl)
  const transaction = (await db()).transaction(['offers', 'evidence', 'settings'], 'readwrite')
  const done = complete(transaction), offers = transaction.objectStore('offers'), images = transaction.objectStore('evidence')
  const saved = recordSchema.safeParse(await value(offers.get(await storedKey(offers, offerId))))
  if (!saved.success || saved.data.offer.captureId !== evidence.id) {
    transaction.abort(); await done.catch(() => {})
    throw new Error('The replacement capture does not belong to this offer.')
  }
  for (const key of await storedKeys(images, evidence.id)) {
    const previous: unknown = await value(images.get(key))
    transaction.objectStore('settings').put({ id: `recovery-evidence:${crypto.randomUUID()}`, key, value: previous })
    images.delete(key)
  }
  images.put(evidence)
  transaction.objectStore('settings').put({ id: 'capture-restore-version', value: crypto.randomUUID() })
  await done; changed()
}
export async function isolateUnreadableOffer(key: IDBValidKey): Promise<void> {
  const transaction = (await db()).transaction(['offers', 'settings', 'deletedOffers', 'captureReceipts'], 'readwrite'), done = complete(transaction)
  const store = transaction.objectStore('offers'), raw: unknown = await value(store.get(key))
  const keys = await value(store.getAllKeys())
  const duplicate = keys.filter(item => String(item).toLowerCase() === String(key).toLowerCase()).length > 1
  if (raw !== undefined && (!recordSchema.safeParse(raw).success || duplicate)) {
    transaction.objectStore('settings').put({ id: `recovery-offer:${crypto.randomUUID()}`, key, value: raw })
    store.delete(key)
    if (!duplicate && typeof key === 'string') transaction.objectStore('deletedOffers').put({ id: key.toLowerCase() })
    const captureId = (raw as { offer?: { captureId?: unknown } })?.offer?.captureId
    if (typeof captureId === 'string') transaction.objectStore('captureReceipts').put({ id: captureId.toLowerCase() })
  }
  await done; changed()
}
export async function saveOffer(draft: Offer, evidence: Evidence | null): Promise<SavedOffer> {
  draft = offerSchema.parse(draft)
  evidence = evidence ? evidenceSchema.parse(evidence) : null
  if (evidence && evidence.id !== draft.captureId) throw new Error('Evidence does not belong to this offer.')
  const database = await db()
  const transaction = database.transaction(['offers', 'evidence', 'deletedOffers'], 'readwrite')
  const done = complete(transaction)
  const store = transaction.objectStore('offers')
  const key = await storedKey(store, draft.id)
  const existing = await value(store.get(key)) as SavedOffer | undefined
  const deleted = transaction.objectStore('deletedOffers')
  if (await value(deleted.get(await storedKey(deleted, draft.id)))) {
    transaction.abort(); await done.catch(() => {})
    throw new OfferDeletedError()
  }
  if (existing && existing.offer.revision !== draft.revision) {
    transaction.abort(); await done.catch(() => {})
    throw new OfferRevisionConflictError()
  }
  const count = await value(store.count())
  if (!existing && count >= 250) { transaction.abort(); await done.catch(() => {}); throw new Error('Local storage is limited to 250 offers. Export and remove older offers first.') }
  const offer = offerSchema.parse({ ...draft, revision: existing ? existing.offer.revision + 1 : draft.revision, updatedAt: new Date().toISOString() })
  const record = { offer, uploadedRevision: existing?.uploadedRevision ?? null, uploadedAt: existing?.uploadedAt ?? null, ...(existing?.uploadedConsentId ? { uploadedConsentId: existing.uploadedConsentId } : {}) }
  if (key !== draft.id) store.delete(key)
  store.put(record)
  if (evidence) await addMissingEvidence(transaction.objectStore('evidence'), evidence)
  await done
  changed()
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
  const transaction = database.transaction(['offers', 'evidence', 'deletedOffers', 'settings'], 'readwrite')
  const done = complete(transaction)
  const store = transaction.objectStore('offers')
  const existingIds = new Set((await value(store.getAllKeys())).map(key => String(key).toLowerCase()))
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
    const deleted = transaction.objectStore('deletedOffers')
    deleted.delete(await storedKey(deleted, offer.id))
  }
  // A metadata backup may already contain the offer but lack its image. Restore
  // only missing evidence for the saved capture reference; never replace edits.
  for (const { offer, evidence } of parsed) {
    if (!evidence) continue
    const saved = await value(store.get(await storedKey(store, offer.id))) as SavedOffer
    if (saved.offer.captureId?.toLowerCase() === evidence.id) await addMissingEvidence(transaction.objectStore('evidence'), evidence)
  }
  // Persist invalidation so readers in every tab recheck restored metadata.
  if (parsed.length) transaction.objectStore('settings').put({ id: 'capture-restore-version', value: crypto.randomUUID() })
  await done
  if (parsed.length) changed()
  return newEntries.length
}
export async function markUploaded(id: string, revision: number, consentId?: string): Promise<void> {
  const database = await db()
  const transaction = database.transaction('offers', 'readwrite')
  const done = complete(transaction)
  const store = transaction.objectStore('offers')
  const key = await storedKey(store, id)
  const record = await value(store.get(key)) as SavedOffer | undefined
  // A response from an earlier consent may arrive after a new consent was selected.
  if (record && (consentId ? sharingConsent()?.id === consentId : !record.uploadedConsentId)) {
    const sameConsent = record.uploadedConsentId === consentId
    if (!sameConsent || revision >= (record.uploadedRevision ?? 0)) {
      store.put({ ...record, uploadedRevision: revision, uploadedAt: new Date().toISOString(), ...(consentId ? { uploadedConsentId: consentId } : {}) })
    }
  }
  await done
  changed()
}
export async function deleteOffer(id: string): Promise<void> {
  const database = await db()
  const transaction = database.transaction(['offers', 'evidence', 'captureReceipts', 'deletedOffers'], 'readwrite')
  const done = complete(transaction)
  const store = transaction.objectStore('offers')
  const key = await storedKey(store, id)
  const record = await value(store.get(key)) as SavedOffer | undefined
  store.delete(key)
  transaction.objectStore('deletedOffers').put({ id: id.toLowerCase() })
  if (record?.offer.captureId) {
    // Retain a receipt so folder sync does not resurrect deliberately deleted captures.
    transaction.objectStore('captureReceipts').put({ id: record.offer.captureId.toLowerCase() })
    const remaining = await value(store.getAll()) as SavedOffer[]
    const images = transaction.objectStore('evidence')
    if (!remaining.some(r => r.offer?.captureId?.toLowerCase() === record.offer.captureId?.toLowerCase())) images.delete(await storedKey(images, record.offer.captureId))
  }
  await done
  changed()
}

export async function hasCaptureReceipt(id: string): Promise<boolean> {
  const transaction = (await db()).transaction(['offers', 'evidence', 'captureReceipts'])
  id = id.toLowerCase()
  const receipts = transaction.objectStore('captureReceipts'), offers = transaction.objectStore('offers'), images = transaction.objectStore('evidence')
  if (!await value(receipts.get(await storedKey(receipts, id)))) return false
  const saved = await value(offers.get(await storedKey(offers, id))) as SavedOffer | undefined
  // A deleted offer stays deleted. Explicitly restored metadata can recover its
  // missing image when the original helper file is encountered again.
  if (!saved || saved.offer.captureId?.toLowerCase() !== id) return true
  return !!await value(images.get(await storedKey(images, id)))
}

export type CaptureDelivery = { status: 'created' | 'restored' | 'unchanged'; offer: Offer | null }
export async function receiveCapture(offer: Offer, evidence: Evidence): Promise<CaptureDelivery> {
  offer = offerSchema.parse({ ...offer, reviewed: false, completeness: 'unverified' })
  evidence = evidenceSchema.parse(evidence)
  if (offer.id !== evidence.id || offer.captureId !== evidence.id || offer.source !== 'windows-helper') throw new Error('Invalid helper capture.')
  const transaction = (await db()).transaction(['offers', 'evidence', 'captureReceipts'], 'readwrite')
  const done = complete(transaction)
  const receipts = transaction.objectStore('captureReceipts')
  const offers = transaction.objectStore('offers')
  const existing = await value(offers.get(await storedKey(offers, offer.id))) as SavedOffer | undefined
  if (existing) {
    const restored = existing.offer.captureId?.toLowerCase() === evidence.id && await addMissingEvidence(transaction.objectStore('evidence'), evidence)
    receipts.put({ id: offer.id }); await done
    if (restored) changed()
    return { status: restored ? 'restored' : 'unchanged', offer: offerSchema.parse(existing.offer) }
  }
  if (await value(receipts.get(await storedKey(receipts, offer.id)))) { await done; return { status: 'unchanged', offer: null } }
  if (await value(offers.count()) >= 250) {
    transaction.abort(); await done.catch(() => {})
    throw new Error('Auto-save paused: 250 offers stored. Export and remove older offers, then resume. New captures remain in the helper folder.')
  }
  offers.put({ offer, uploadedRevision: null, uploadedAt: null })
  transaction.objectStore('evidence').put(evidence)
  receipts.put({ id: offer.id })
  await done
  changed()
  return { status: 'created', offer }
}

const recoveryDraftSchema = z.object({ id: z.string().uuid(), savedAt: z.string().datetime(), offer: offerSchema, evidence: evidenceSchema.nullable() })
export type RecoveryDraft = z.infer<typeof recoveryDraftSchema>
export async function writeDraftRecovery(id: string, offer: Offer, evidence: Evidence | null): Promise<void> {
  const record = recoveryDraftSchema.parse({ id, savedAt: new Date().toISOString(), offer, evidence })
  const transaction = (await db()).transaction('settings', 'readwrite'), done = complete(transaction)
  transaction.objectStore('settings').put({ id: `draft:${id}`, value: record })
  await done
}
export async function removeDraftRecovery(id: string): Promise<void> {
  const transaction = (await db()).transaction('settings', 'readwrite'), done = complete(transaction)
  transaction.objectStore('settings').delete(`draft:${id}`)
  await done
}
export async function listDraftRecovery(): Promise<RecoveryDraft[]> {
  const records = await value((await db()).transaction('settings').objectStore('settings').getAll()) as { id: string; value: unknown }[]
  return records.filter(record => record.id.startsWith('draft:')).flatMap(record => {
    const parsed = recoveryDraftSchema.safeParse(record.value)
    return parsed.success ? [parsed.data] : []
  }).sort((a, b) => b.savedAt.localeCompare(a.savedAt))
}

export async function storageHealth() {
  const database = await db()
  const offers = await value(database.transaction('offers').objectStore('offers').count())
  const manager = typeof navigator !== 'undefined' ? navigator.storage : undefined
  const [estimate, persistent] = await Promise.all([manager?.estimate?.().catch((): StorageEstimate => ({})), manager?.persisted?.().catch(() => false)])
  return { offers, limit: 250, usage: estimate?.usage ?? null, quota: estimate?.quota ?? null, persistent: persistent ?? false,
    canPersist: typeof manager?.persist === 'function' }
}

export async function captureRestoreVersion(): Promise<string> {
  const record = await value((await db()).transaction('settings').objectStore('settings').get('capture-restore-version')) as { value: string } | undefined
  return record?.value ?? ''
}

export async function handledCaptureIds(): Promise<Set<string>> {
  const transaction = (await db()).transaction(['offers', 'evidence', 'captureReceipts'])
  // Issue these together, keeping the transaction alive and avoiding a query per
  // historical file on reconnect. Evidence values (images) are never loaded.
  const [ids, offers, evidenceIds] = await Promise.all([
    value(transaction.objectStore('captureReceipts').getAllKeys()),
    value(transaction.objectStore('offers').getAll()) as Promise<SavedOffer[]>,
    value(transaction.objectStore('evidence').getAllKeys()),
  ])
  const handled = new Set(ids.map(id => String(id).toLowerCase())), evidence = new Set(evidenceIds.map(id => String(id).toLowerCase()))
  for (const { offer } of offers) {
    if (offer?.captureId?.toLowerCase() === offer?.id?.toLowerCase() && offer?.id && !evidence.has(offer.id.toLowerCase())) handled.delete(offer.id.toLowerCase())
  }
  return handled
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
