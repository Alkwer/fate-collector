import 'fake-indexeddb/auto'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { newCard, newOffer } from '../shared/offers'
import { exportSchema, type Archive, type Evidence } from '../shared/schema'
import { combineBackupParts } from '../shared/backups'
import { createBackupParts, importFiles, importJson, recoverBackup } from '../src/lib/imports'
import {
  deleteOffer, getOffer, handledCaptureIds, hasCaptureReceipt, importOffers, isolateUnreadableOffer,
  listDraftRecovery, listOffers, readEvidence, readOfferArchive, readOfferHistory, readOfferRecovery,
  receiveCapture, removeDraftRecovery, repairEvidence, restoreEvidence, saveOffer, writeDraftRecovery, readDraftRecovery, deleteOffers, replaceImportedOffer,
} from '../src/lib/storage'
import { CaptureReader, compareCaptures, type CaptureDirectory } from '../src/lib/capture-sync'

let database: IDBDatabase
const validImage = 'data:image/png;base64,AQ=='
const damagedImage = 'data:image/png;base64,Ag=='
const evidenceFor = (id: string, imageDataUrl = validImage): Evidence => ({
  id, imageDataUrl, ocrText: 'Original OCR evidence', ocrLines: [], ocrStatus: 'ok', helperVersion: '0.3.4',
})
function finished(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}
async function rawPut(store: string, entry: unknown) {
  const transaction = database.transaction(store, 'readwrite')
  const done = finished(transaction)
  transaction.objectStore(store).put(entry)
  await done
}
function rawGet(store: string, key: IDBValidKey): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = database.transaction(store).objectStore(store).get(key)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

beforeEach(async () => {
  // Deliberately model decoder failure; these bytes are unit-test markers, not PNG fixtures.
  vi.stubGlobal('createImageBitmap', vi.fn(async (blob: Blob) => {
    if (new Uint8Array(await blob.arrayBuffer())[0] !== 1) throw new Error('Synthetic decoder rejection')
    return { width: 2, height: 2, close: vi.fn() }
  }))
  await listOffers() // Let the production module create its real store layout.
  database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('fate-collector', 3)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const stores = Array.from(database.objectStoreNames)
  const transaction = database.transaction(stores, 'readwrite'), done = finished(transaction)
  for (const store of stores) transaction.objectStore(store).clear()
  await done
})
afterEach(() => { database?.close(); vi.unstubAllGlobals() })

test('damaged recovery drafts remain discoverable, exportable and individually removable', async () => {
  const good = crypto.randomUUID(), bad = crypto.randomUUID()
  await writeDraftRecovery(good, newOffer(), null)
  const original = { id: `draft:${bad}`, value: { id: bad, broken: 'Keep these raw bytes' } }
  await rawPut('settings', original)
  const result = await readDraftRecovery()
  expect(result.drafts.map(draft => draft.id)).toEqual([good])
  expect(result.unreadable.map(draft => draft.id)).toEqual([bad])
  expect((await readOfferRecovery()).drafts).toContainEqual(original)
  await removeDraftRecovery(bad)
  expect((await readDraftRecovery()).unreadable).toEqual([])
  expect((await readDraftRecovery()).drafts).toHaveLength(1)
})

test('unordered folder delivery saves every capture but never presents an older backlog item', async () => {
  const captures = ['2026-11-13T10:00:00Z', '2026-11-13T09:00:00Z', '2026-11-13T11:00:00Z'].map(capturedAt => ({
    kind: 'fate-collector.capture', schemaVersion: 1, captureId: crypto.randomUUID(), capturedAt, source: 'windows-helper', helperVersion: '0.1.0',
    image: { width: 2, height: 2, mimeType: 'image/png', dataBase64: 'AQ==' }, ocr: { status: 'unavailable', text: '', lines: [], language: null },
  }))
  const folder = { queryPermission: async () => 'granted', async *values() {
    for (const capture of captures) yield { kind: 'file', name: `fate-${capture.captureId}.json`, getFile: async () => new File([JSON.stringify(capture)], 'capture.json') }
  } } as unknown as CaptureDirectory
  const shown: string[] = []
  await new CaptureReader().scan(folder, async entry => { if (entry.present) shown.push(entry.offer.id) }, () => false)
  expect(shown).toEqual([captures[0].captureId, captures[2].captureId])
  expect(await listOffers()).toHaveLength(3)
  const session = { id: crypto.randomUUID(), startedAt: '2026-11-13T08:00:00Z' }
  expect(compareCaptures({ ...newOffer(), capturedAt: captures[1].capturedAt, captureContext: { captureMode: 'game', session: { ...session, sequence: 3 } } }, { ...newOffer(), capturedAt: captures[0].capturedAt, captureContext: { captureMode: 'game', session: { ...session, sequence: 2 } } })).toBeGreaterThan(0)
})

test('bulk deletion aborts all writes when any selected revision has changed', async () => {
  const first = (await saveOffer(newOffer(), null)).offer, second = (await saveOffer(newOffer(), null)).offer
  const updated = (await saveOffer({ ...second, notes: 'Another tab corrected this' }, null)).offer
  await expect(deleteOffers([first, second])).rejects.toThrow('Nothing was removed')
  expect(await listOffers()).toHaveLength(2)
  expect(await rawGet('deletedOffers', first.id)).toBeUndefined()
  await deleteOffers([first, updated])
  expect(await listOffers()).toEqual([])
})

for (const restore of ['manual import', 'folder sync'] as const) {
  test(`${restore} restores only the original card regions after a data-only backup`, async () => {
    vi.stubGlobal('createImageBitmap', async () => ({ width: 1000, height: 600, close() {} }))
    const captureId = crypto.randomUUID()
    const line = (text: string, x: number, y: number) => ({ text, x, y, width: 100, height: 15 })
    const capture = JSON.stringify({ kind: 'fate-collector.capture', schemaVersion: 1, captureId, capturedAt: new Date().toISOString(), source: 'windows-helper', helperVersion: '0.3.4',
      image: { width: 1000, height: 600, mimeType: 'image/png', dataBase64: 'AQ==' },
      ocr: { status: 'ok', language: 'en-US', text: '', lines: [line('Fates', 450, 10), line('Torchbearer', 200, 100), line('Torchbearer', 700, 100), line('CONFIRM', 450, 500)] } })
    const { offer, evidence } = (await importJson(capture)).entries[0]
    const [left, right] = offer.cards
    const [leftRegion, rightRegion] = evidence!.cardRegions!
    expect(left.id).not.toBe(right.id)
    expect([leftRegion.cardId, rightRegion.cardId]).toEqual([left.id, right.id])
    expect(leftRegion.x).toBeLessThan(rightRegion.x)

    // Duplicate names and a removed card replaced manually at the same position
    // cannot be used to infer which region a card belongs to.
    const manual = { ...newCard(), name: left.name }
    const corrected = (await saveOffer({ ...offer, cards: [{ ...right, name: 'Corrected name' }, manual], selectedCardId: right.id }, evidence)).offer
    const builder = createBackupParts(false)
    await readOfferArchive(false, entry => builder.add(entry))
    const dataOnly = (await importJson(await builder.finish()[0].blob.text())).entries
    expect(dataOnly).toEqual([{ offer: corrected, evidence: null }])
    const recreate = async (archived = corrected) => {
      await deleteOffer(captureId)
      await importOffers([{ offer: archived, evidence: null }])
      const imported = (await importJson(capture)).entries[0]
      if (restore === 'manual import') expect(await restoreEvidence(captureId, imported.evidence!)).toBe(true)
      else expect((await receiveCapture(imported.offer, imported.evidence!)).status).toBe('restored')
      expect((await getOffer(captureId))?.offer).toEqual(archived)
      return (await readEvidence(captureId, true)).evidence!
    }
    const restored = await recreate(dataOnly[0].offer)
    expect(restored.cardRegions?.find(region => region.cardId === right.id)).toEqual(rightRegion)
    expect(restored.cardRegions?.find(region => region.cardId === manual.id)).toBeUndefined()

    const legacy = { ...corrected, cards: offer.cards.map(card => ({ ...card, id: crypto.randomUUID() })), selectedCardId: null }
    const legacyEvidence = await recreate(legacy)
    expect(legacyEvidence.imageDataUrl).toBe(evidence!.imageDataUrl)
    expect(legacyEvidence.cardRegions?.some(region => legacy.cards.some(card => card.id === region.cardId))).toBe(false)
  })
}

test('explicit imported corrections preserve the previous original and reject stale comparisons', async () => {
  const local = (await saveOffer({ ...newOffer(), notes: 'Keep this original' }, null)).offer
  const incoming = { ...local, revision: 8, notes: 'Imported correction' }
  await replaceImportedOffer(incoming, local)
  expect((await getOffer(local.id))?.offer).toMatchObject({ revision: 9, notes: incoming.notes })
  expect((await readOfferRecovery()).isolated).toContainEqual(expect.objectContaining({ value: expect.objectContaining({ offer: local }) }))
  await expect(replaceImportedOffer(incoming, local)).rejects.toThrow('changed since comparison')
  expect((await getOffer(local.id))?.offer.revision).toBe(9)
})

test('a decoder-rejected image leaves readable offer metadata and the original evidence untouched', async () => {
  const id = crypto.randomUUID(), evidence = evidenceFor(id, damagedImage)
  const saved = await saveOffer({ ...newOffer(), captureId: id, notes: 'Keep the correction' }, evidence)
  expect(await readEvidence(id, true)).toMatchObject({ status: 'damaged', evidence: null, warning: expect.any(String) })
  expect(await getOffer(saved.offer.id)).toEqual(saved)
  expect((await readOfferHistory()).records).toEqual([saved])
  expect(await rawGet('evidence', id)).toEqual(evidence)
})

test('a full backup omits damaged image bytes, reports the omission and keeps valid metadata importable', async () => {
  const id = crypto.randomUUID(), evidence = evidenceFor(id, damagedImage)
  const saved = await saveOffer({ ...newOffer(), captureId: id, notes: 'Metadata survives export' }, evidence)
  const builder = createBackupParts(true)
  expect(await readOfferArchive(true, entry => builder.add(entry))).toEqual({ offers: 1, omittedOffers: 0, missingEvidence: 0, damagedEvidence: 1 })
  const imported = await importJson(await builder.finish()[0].blob.text())
  expect(imported.entries).toEqual([{ offer: saved.offer, evidence: null }])
  expect(await rawGet('evidence', id)).toEqual(evidence)
})

test('explicit evidence repair archives its exact original and makes the replacement decodable', async () => {
  const id = crypto.randomUUID(), original = evidenceFor(id, damagedImage)
  const saved = await saveOffer({ ...newOffer(), captureId: id, revision: 7 }, original)
  await repairEvidence(saved.offer.id, evidenceFor(id))
  expect(await readEvidence(id, true)).toMatchObject({ status: 'available', evidence: evidenceFor(id) })
  expect((await getOffer(saved.offer.id))?.offer).toEqual(saved.offer)
  expect((await readOfferRecovery()).isolated).toContainEqual({ id: expect.stringMatching(/^recovery-evidence:/), key: id, value: original })
})

test('isolating a malformed offer preserves raw fields and blocks both sync and stale-editor resurrection', async () => {
  const id = crypto.randomUUID(), evidence = evidenceFor(id)
  const draft = { ...newOffer(), id, captureId: id, source: 'windows-helper' as const }
  const malformed = { offer: { ...draft, revision: 'corrupt', unknownOriginalField: 'Keep verbatim' }, uploadedAt: null, uploadedRevision: null }
  await rawPut('offers', malformed)
  await rawPut('evidence', evidence)
  await isolateUnreadableOffer(id)
  expect(await listOffers()).toEqual([])
  expect((await readOfferHistory()).isolatedCount).toBe(1)
  expect((await readOfferRecovery()).isolated).toContainEqual({ id: expect.stringMatching(/^recovery-offer:/), key: id, value: malformed })
  expect((await readOfferRecovery()).evidence).toContainEqual({ key: id, value: evidence })
  expect(await rawGet('evidence', id)).toEqual(evidence)
  expect(await hasCaptureReceipt(id)).toBe(true)
  expect(await handledCaptureIds()).toContain(id)
  expect(await receiveCapture(draft, evidence)).toEqual({ status: 'unchanged', offer: null })
  await expect(saveOffer(draft, evidence)).rejects.toThrow('deleted')
})

test('historical uppercase keys can be read, corrected and deleted through canonical IDs without duplicates', async () => {
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const rawOffer = { ...newOffer(), id: id.toUpperCase(), captureId: id.toUpperCase(), revision: 5 }
  await rawPut('offers', { offer: rawOffer, uploadedAt: null, uploadedRevision: null })
  await rawPut('evidence', evidenceFor(id.toUpperCase()))
  const saved = await getOffer(id)
  expect(saved?.offer).toMatchObject({ id, captureId: id, revision: 5 })
  expect(await readEvidence(id, true)).toMatchObject({ status: 'available', evidence: { id } })
  expect((await readOfferHistory()).missingEvidenceIds).toEqual([])
  expect(await importOffers([{ offer: saved!.offer, evidence: null }])).toBe(0)
  const correction = await saveOffer({ ...saved!.offer, notes: 'Canonical correction' }, null)
  expect(correction.offer.revision).toBe(6)
  expect(await rawGet('offers', id.toUpperCase())).toBeUndefined()
  expect(await listOffers()).toHaveLength(1)
  await deleteOffer(id.toUpperCase())
  expect(await listOffers()).toEqual([])
  expect(await rawGet('evidence', id.toUpperCase())).toBeUndefined()
  expect(await hasCaptureReceipt(id)).toBe(true)
})

test('draft recovery preserves the saved revision and original record until an explicit save', async () => {
  const saved = await saveOffer({ ...newOffer(), revision: 9, notes: 'Saved text' }, null)
  const sessionId = crypto.randomUUID(), draft = { ...saved.offer, notes: 'Unsaved recovered text' }
  await writeDraftRecovery(sessionId, draft, null)
  expect(await listDraftRecovery()).toEqual([{ id: sessionId, savedAt: expect.any(String), offer: draft, evidence: null }])
  expect(await getOffer(saved.offer.id)).toEqual(saved)
  await removeDraftRecovery(sessionId)
  expect(await listDraftRecovery()).toEqual([])
  expect((await getOffer(saved.offer.id))?.offer.revision).toBe(9)
})

test('conflicting historical evidence preserves metadata and exports both originals for recovery', async () => {
  const id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', original = evidenceFor(id)
  const variant = { ...evidenceFor(id.toUpperCase()), ocrText: 'Different historical OCR' }
  const saved = await saveOffer({ ...newOffer(), captureId: id, notes: 'Keep metadata' }, original)
  await rawPut('evidence', variant)
  expect(await readEvidence(id, true)).toMatchObject({ status: 'damaged', evidence: null, warning: expect.any(String) })
  expect(await getOffer(saved.offer.id)).toEqual(saved)
  const entries: Archive['offers'] = []
  expect(await readOfferArchive(true, entry => entries.push(entry))).toEqual({ offers: 1, omittedOffers: 0, missingEvidence: 0, damagedEvidence: 1 })
  expect(entries).toEqual([{ offer: saved.offer, evidence: null }])
  expect((await readOfferRecovery()).evidence).toEqual(expect.arrayContaining([
    { key: id, value: original }, { key: id.toUpperCase(), value: variant },
  ]))
  expect(await rawGet('evidence', id)).toEqual(original)
  expect(await rawGet('evidence', id.toUpperCase())).toEqual(variant)
})

test('explicit repair of historical evidence collisions preserves every original before replacing them', async () => {
  const id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', original = evidenceFor(id)
  const variant = { ...evidenceFor(id.toUpperCase()), ocrText: 'Second original' }
  const saved = await saveOffer({ ...newOffer(), captureId: id }, original)
  await rawPut('evidence', variant)
  const replacement = { ...original, ocrText: 'Restored from the original capture' }
  await repairEvidence(saved.offer.id, replacement)
  expect(await readEvidence(id, true)).toMatchObject({ status: 'available', evidence: replacement })
  expect(await rawGet('evidence', id.toUpperCase())).toBeUndefined()
  expect((await readOfferRecovery()).isolated).toEqual(expect.arrayContaining([
    { id: expect.stringMatching(/^recovery-evidence:/), key: id, value: original },
    { id: expect.stringMatching(/^recovery-evidence:/), key: id.toUpperCase(), value: variant },
  ]))
  expect(await getOffer(saved.offer.id)).toEqual(saved)
})

test('a rejected save or deletion rolls back pending writes when evidence keys conflict', async () => {
  const id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', evidence = evidenceFor(id)
  const saved = await saveOffer({ ...newOffer(), captureId: id, revision: 4, notes: 'Original' }, evidence)
  await rawPut('evidence', evidenceFor(id.toUpperCase()))
  await expect(saveOffer({ ...saved.offer, notes: 'Must not commit' }, evidence)).rejects.toThrow('Conflicting historical identifiers')
  expect(await getOffer(saved.offer.id)).toEqual(saved)
  await expect(deleteOffer(saved.offer.id)).rejects.toThrow('Conflicting historical identifiers')
  expect(await getOffer(saved.offer.id)).toEqual(saved)
  expect(await rawGet('deletedOffers', saved.offer.id)).toBeUndefined()
  expect(await rawGet('captureReceipts', id)).toBeUndefined()
})

test('an evidence collision aborts the whole import including prior offers, evidence and tombstone changes', async () => {
  const id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', evidence = evidenceFor(id)
  await rawPut('evidence', evidence)
  await rawPut('evidence', evidenceFor(id.toUpperCase()))
  const firstId = crypto.randomUUID(), first = { offer: { ...newOffer(), captureId: firstId }, evidence: evidenceFor(firstId) }
  const second = { offer: { ...newOffer(), captureId: id }, evidence }
  await rawPut('deletedOffers', { id: first.offer.id })
  await expect(importOffers([first, second])).rejects.toThrow('Conflicting historical identifiers')
  expect(await listOffers()).toEqual([])
  expect(await rawGet('evidence', firstId)).toBeUndefined()
  expect(await rawGet('deletedOffers', first.offer.id)).toEqual({ id: first.offer.id })
  expect(await rawGet('settings', 'capture-restore-version')).toBeUndefined()
  expect(await rawGet('evidence', id)).toEqual(evidence)
})

function backupPart(setId: string, part: number, total: number): Archive {
  return exportSchema.parse({ kind: 'fate-collector.export', schemaVersion: 1, backup: { setId, part, total }, offers: [{ offer: newOffer(), evidence: null }] })
}
const backupFile = (archive: Archive) => new File([JSON.stringify(archive)], 'backup.json', { type: 'application/json' })

test('complete multipart import orders every part and leaves storage unchanged until explicit restoration', async () => {
  const setId = crypto.randomUUID(), first = backupPart(setId, 1, 2), second = backupPart(setId, 2, 2)
  const imported = await importFiles([backupFile(second), backupFile(first)])
  expect(imported.entries).toEqual([...first.offers, ...second.offers])
  expect(imported.message).toContain('Complete backup set')
  expect(await listOffers()).toEqual([])
  await importOffers(imported.entries)
  expect(await listOffers()).toHaveLength(2)
})

test('missing, duplicated and mixed multipart sets fail before changing storage', async () => {
  const setId = crypto.randomUUID(), first = backupPart(setId, 1, 3), second = backupPart(setId, 2, 3)
  await expect(importFiles([backupFile(first), backupFile(second)])).rejects.toThrow('Incomplete backup')
  expect(() => combineBackupParts([first, first])).toThrow('same backup part')
  await expect(importFiles([backupFile(first), backupFile(backupPart(crypto.randomUUID(), 2, 3))])).rejects.toThrow('different backup sets')
  const unrelated = exportSchema.parse({ kind: 'fate-collector.export', schemaVersion: 1, offers: [{ offer: newOffer(), evidence: null }] })
  expect(() => combineBackupParts([first, unrelated])).toThrow('unrelated exports')
  expect(await listOffers()).toEqual([])
})

test('explicit backup salvage keeps readable offer fields and reports image loss without modifying its input', async () => {
  const id = crypto.randomUUID(), offer = { ...newOffer(), captureId: id, notes: 'Recovered metadata' }
  const original = JSON.stringify({ kind: 'fate-collector.export', schemaVersion: 1, offers: [{ offer, evidence: evidenceFor(id, damagedImage) }] })
  const file = new File([original], 'damaged-backup.json', { type: 'application/json' })
  const imported = await recoverBackup(file)
  expect(imported.entries).toEqual([{ offer, evidence: null }])
  expect(imported.message).toContain('1 damaged evidence')
  expect(await file.text()).toBe(original)
  expect(await listOffers()).toEqual([])
})
