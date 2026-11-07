import 'fake-indexeddb/auto'
import { expect, test } from 'vitest'
import { newOffer, exampleOffer } from '../shared/offers'
import { saveOffer, getOffer, listOffers, markUploaded, deleteOffer, importOffers, receiveCapture, hasCaptureReceipt, getEvidence, restoreEvidence } from '../src/lib/storage'
import type { Evidence } from '../shared/schema'

test('corrections use one local offer with increasing revisions and retry receipts do not hide unsent changes', async () => {
  const draft = exampleOffer()
  const first = await saveOffer(draft, null)
  await markUploaded(draft.id, first.offer.revision)
  const second = await saveOffer({ ...first.offer, area: 'Test area' }, null)
  expect(second.offer.revision).toBe(2)
  expect(second.uploadedRevision).toBe(1)
  await markUploaded(draft.id, 1)
  expect((await getOffer(draft.id))?.uploadedRevision).toBe(1)
  expect((await listOffers()).filter(r => r.offer.id === draft.id)).toHaveLength(1)
  await deleteOffer(draft.id)
  expect(await getOffer(draft.id)).toBeUndefined()
})
test('unread captures can be saved for later review', async () => {
  const draft = newOffer()
  const saved = await saveOffer(draft, null)
  expect(saved.offer.cards).toEqual([])
  expect(saved.offer.reviewed).toBe(false)
  await deleteOffer(draft.id)
})

test('bulk imports preserve corrections and reject overflowing archives without a partial import', async () => {
  const existing = newOffer()
  await saveOffer({ ...existing, notes: 'Keep my correction' }, null)
  const next = newOffer()
  expect(await importOffers([{ offer: existing, evidence: null }, { offer: next, evidence: null }, { offer: next, evidence: null }])).toBe(1)
  expect((await getOffer(existing.id))?.offer.notes).toBe('Keep my correction')
  const oversized = Array.from({ length: 249 }, () => ({ offer: newOffer(), evidence: null }))
  await expect(importOffers(oversized)).rejects.toThrow('Nothing was imported')
  expect(await listOffers()).toHaveLength(2)
  await deleteOffer(existing.id); await deleteOffer(next.id)
})

function captureEntry() {
  const offer = { ...newOffer(), source: 'windows-helper' as const }
  offer.captureId = offer.id
  const evidence: Evidence = { id: offer.id, imageDataUrl: 'data:image/png;base64,eA==', ocrText: '', ocrLines: [], ocrStatus: 'unavailable', helperVersion: '0.1.0' }
  return { offer, evidence }
}
test('automatic delivery is atomic across readers, preserves corrections and does not resurrect deletions', async () => {
  const { offer, evidence } = captureEntry()
  const results = await Promise.all([receiveCapture(offer, evidence), receiveCapture(offer, evidence)])
  expect(results.sort()).toEqual([false, true])
  expect((await getOffer(offer.id))?.offer).toMatchObject({ reviewed: false, completeness: 'unverified', revision: 1 })
  expect(await getEvidence(offer.id)).toEqual(evidence)
  await saveOffer({ ...offer, notes: 'Keep my correction' }, evidence)
  expect(await receiveCapture(offer, evidence)).toBe(false)
  expect((await getOffer(offer.id))?.offer.notes).toBe('Keep my correction')
  await deleteOffer(offer.id)
  expect(await hasCaptureReceipt(offer.id)).toBe(true)
  expect(await receiveCapture(offer, evidence)).toBe(false)
  expect(await getOffer(offer.id)).toBeUndefined()
})
test('storage-full delivery remains retryable and does not acknowledge an unsaved capture', async () => {
  const entries = Array.from({ length: 250 }, () => ({ offer: newOffer(), evidence: null }))
  await importOffers(entries)
  const { offer, evidence } = captureEntry()
  await expect(receiveCapture(offer, evidence)).rejects.toThrow('Auto-save paused')
  expect(await hasCaptureReceipt(offer.id)).toBe(false)
  await deleteOffer(entries[0].offer.id)
  expect(await receiveCapture(offer, evidence)).toBe(true)
  await Promise.all(entries.slice(1).map(entry => deleteOffer(entry.offer.id)))
  await deleteOffer(offer.id)
})

test('original evidence can be restored after a metadata backup without replacing corrections or existing evidence', async () => {
  const { offer, evidence } = captureEntry()
  const saved = await saveOffer({ ...offer, notes: 'Keep my correction' }, null)
  await markUploaded(offer.id, saved.offer.revision)
  expect(await restoreEvidence(offer.id, evidence)).toBe(true)
  expect(await getEvidence(offer.id)).toEqual(evidence)
  expect(await getOffer(offer.id)).toMatchObject({ offer: saved.offer, uploadedRevision: saved.offer.revision })
  expect(await restoreEvidence(offer.id, { ...evidence, ocrText: 'Replacement' })).toBe(false)
  expect(await getEvidence(offer.id)).toEqual(evidence)
  await expect(restoreEvidence(offer.id, { ...evidence, id: crypto.randomUUID() })).rejects.toThrow('does not belong')
  await deleteOffer(offer.id)
})

test('archive import restores missing images for existing IDs and preserves local corrections', async () => {
  const { offer, evidence } = captureEntry()
  const saved = await saveOffer({ ...offer, notes: 'Keep my correction' }, null)
  expect(await importOffers([{ offer, evidence }])).toBe(0)
  expect((await getOffer(offer.id))?.offer).toEqual(saved.offer)
  expect(await getEvidence(offer.id)).toEqual(evidence)
  await deleteOffer(offer.id)
})

test('folder intake repairs missing evidence on restored metadata, including an existing receipt, without resurrecting deletions', async () => {
  const { offer, evidence } = captureEntry()
  await receiveCapture(offer, evidence)
  await deleteOffer(offer.id)
  expect(await hasCaptureReceipt(offer.id)).toBe(true)
  expect(await receiveCapture(offer, evidence)).toBe(false)
  const saved = await saveOffer({ ...offer, notes: 'Restored correction' }, null)
  expect(await hasCaptureReceipt(offer.id)).toBe(false)
  expect(await receiveCapture(offer, evidence)).toBe(false)
  expect((await getOffer(offer.id))?.offer).toEqual(saved.offer)
  expect(await getEvidence(offer.id)).toEqual(evidence)
  expect(await hasCaptureReceipt(offer.id)).toBe(true)
  await deleteOffer(offer.id)
})
