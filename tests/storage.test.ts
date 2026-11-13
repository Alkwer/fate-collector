import 'fake-indexeddb/auto'
import { expect, test, vi } from 'vitest'
import { newOffer, exampleOffer } from '../shared/offers'
import { importJson } from '../src/lib/imports'
import * as consent from '../src/lib/consent'
import { saveOffer, getOffer, listOffers, markUploaded, deleteOffer, importOffers, receiveCapture, hasCaptureReceipt, getEvidence, restoreEvidence, OfferRevisionConflictError, OfferDeletedError } from '../src/lib/storage'
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

test('upload receipts keep their own revision when a different consent replaces a withdrawn grant', async () => {
  const draft = exampleOffer()
  const timestamp = new Date().toISOString()
  const previous: consent.LocalConsent = {
    id: crypto.randomUUID(), scope: 'observations', policyVersion: 'test', text: 'Test consent',
    token: '0'.repeat(64), acceptedAt: timestamp, recordedAt: timestamp,
    withdrawnAt: null, withdrawalConfirmedAt: null, blocked: false,
  }
  const current = { ...previous, id: crypto.randomUUID() }
  const active = vi.spyOn(consent, 'sharingConsent').mockReturnValue(previous)
  try {
    const first = await saveOffer(draft, null)
    const second = await saveOffer({ ...first.offer, notes: 'Correction' }, null)
    await markUploaded(draft.id, second.offer.revision, previous.id)
    active.mockReturnValue(current)
    await markUploaded(draft.id, first.offer.revision, current.id)
    await markUploaded(draft.id, second.offer.revision, previous.id)
    expect(await getOffer(draft.id)).toMatchObject({
      uploadedRevision: first.offer.revision, uploadedConsentId: current.id,
    })
    await markUploaded(draft.id, second.offer.revision, current.id)
    await markUploaded(draft.id, first.offer.revision, current.id)
    expect(await getOffer(draft.id)).toMatchObject({
      uploadedRevision: second.offer.revision, uploadedConsentId: current.id,
    })
  } finally {
    active.mockRestore()
    await deleteOffer(draft.id)
  }
})

test('unread captures can be saved for later review', async () => {
  const draft = newOffer()
  const saved = await saveOffer(draft, null)
  expect(saved.offer.cards).toEqual([])
  expect(saved.offer.reviewed).toBe(false)
  await deleteOffer(draft.id)
})

test('a stale editor cannot overwrite a newer revision or its upload receipt', async () => {
  const first = await saveOffer(exampleOffer(), null)
  const latest = await saveOffer({ ...first.offer, notes: 'Correction from tab A' }, null)
  await markUploaded(first.offer.id, latest.offer.revision)
  await expect(saveOffer({ ...first.offer, area: 'Stale tab B' }, null)).rejects.toBeInstanceOf(OfferRevisionConflictError)
  expect(await getOffer(first.offer.id)).toMatchObject({ offer: latest.offer, uploadedRevision: latest.offer.revision })
  const next = await saveOffer({ ...latest.offer, area: 'Reopened latest revision' }, null)
  expect(next.offer).toMatchObject({ revision: 3, notes: 'Correction from tab A', area: 'Reopened latest revision' })
  await deleteOffer(first.offer.id)
})

test('concurrent edits of one revision have exactly one winner', async () => {
  const first = await saveOffer(exampleOffer(), null)
  const results = await Promise.allSettled([
    saveOffer({ ...first.offer, notes: 'Tab A' }, null),
    saveOffer({ ...first.offer, notes: 'Tab B' }, null),
  ])
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
  const winner = results.find(result => result.status === 'fulfilled')!
  expect((await getOffer(first.offer.id))?.offer).toEqual(winner.value.offer)
  expect(winner.value.offer.revision).toBe(2)
  await deleteOffer(first.offer.id)
})

test('deleted offers reject stale writes, including manual offers, but explicit restoration is allowed', async () => {
  for (const entry of [{ offer: exampleOffer(), evidence: null }, captureEntry()]) {
    const first = await saveOffer(entry.offer, entry.evidence)
    await deleteOffer(first.offer.id)
    await expect(saveOffer({ ...first.offer, notes: 'Stale tab' }, entry.evidence)).rejects.toBeInstanceOf(OfferDeletedError)
    expect(await getOffer(first.offer.id)).toBeUndefined()
    expect(await getEvidence(first.offer.captureId)).toBeNull()
    await importOffers([{ offer: first.offer, evidence: entry.evidence }])
    const corrected = await saveOffer({ ...first.offer, notes: 'Explicitly restored' }, entry.evidence)
    expect(corrected.offer.revision).toBe(2)
    await deleteOffer(first.offer.id)
  }
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
  expect(results.map(result => result.status).sort()).toEqual(['created', 'unchanged'])
  expect((await getOffer(offer.id))?.offer).toMatchObject({ reviewed: false, completeness: 'unverified', revision: 1 })
  expect(await getEvidence(offer.id)).toEqual(evidence)
  await saveOffer({ ...offer, notes: 'Keep my correction' }, evidence)
  expect((await receiveCapture(offer, evidence)).status).toBe('unchanged')
  expect((await getOffer(offer.id))?.offer.notes).toBe('Keep my correction')
  await deleteOffer(offer.id)
  expect(await hasCaptureReceipt(offer.id)).toBe(true)
  expect((await receiveCapture(offer, evidence)).status).toBe('unchanged')
  expect(await getOffer(offer.id)).toBeUndefined()
})
test('storage-full delivery remains retryable and does not acknowledge an unsaved capture', async () => {
  const entries = Array.from({ length: 250 }, () => ({ offer: newOffer(), evidence: null }))
  await importOffers(entries)
  const { offer, evidence } = captureEntry()
  await expect(receiveCapture(offer, evidence)).rejects.toThrow('Auto-save paused')
  expect(await hasCaptureReceipt(offer.id)).toBe(false)
  await deleteOffer(entries[0].offer.id)
  expect((await receiveCapture(offer, evidence)).status).toBe('created')
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

test('area corrections survive repeated capture intake and backup restoration', async () => {
  const { offer, evidence } = captureEntry()
  const detected = { ...offer, areaCategory: 'campaign' as const, captureContext: { captureMode: 'game' as const,
    area: { source: 'client-log' as const, category: 'campaign' as const, areaId: '1_1_1', areaLevel: 1 } } }
  await receiveCapture(detected, evidence)
  const saved = await saveOffer({ ...detected, areaCategory: 'other' }, evidence)
  await receiveCapture(detected, evidence)
  expect((await getOffer(offer.id))?.offer).toEqual(saved.offer)
  const backup = { kind: 'fate-collector.export', schemaVersion: 1, offers: [{ offer: saved.offer, evidence: null }] }
  await deleteOffer(offer.id)
  await importOffers((await importJson(JSON.stringify(backup))).entries)
  expect((await getOffer(offer.id))?.offer).toMatchObject({ areaCategory: 'other', captureContext: detected.captureContext })
  await deleteOffer(offer.id)
})

test('archive import retains session and possible repeat metadata on a reviewed correction', async () => {
  const { offer } = captureEntry()
  const corrected = { ...offer, revision: 2, reviewed: true, completeness: 'partial', notes: 'Reviewed correction', captureContext: {
    captureMode: 'game', session: { id: crypto.randomUUID(), startedAt: offer.capturedAt, sequence: 2 },
    possibleDuplicate: { ofCaptureId: crypto.randomUUID(), reason: 'same-ocr-within-15s' },
  } }
  const archive = { kind: 'fate-collector.export', schemaVersion: 1, offers: [{ offer: corrected, evidence: null }] }
  const { entries } = await importJson(JSON.stringify(archive))
  expect(await importOffers(entries)).toBe(1)
  expect((await getOffer(offer.id))?.offer).toEqual(corrected)
  await deleteOffer(offer.id)
})

test('folder intake repairs missing evidence on restored metadata, including an existing receipt, without resurrecting deletions', async () => {
  const { offer, evidence } = captureEntry()
  await receiveCapture(offer, evidence)
  await deleteOffer(offer.id)
  expect(await hasCaptureReceipt(offer.id)).toBe(true)
  expect((await receiveCapture(offer, evidence)).status).toBe('unchanged')
  await importOffers([{ offer: { ...offer, notes: 'Restored correction' }, evidence: null }])
  const saved = (await getOffer(offer.id))!
  expect(await hasCaptureReceipt(offer.id)).toBe(false)
  expect((await receiveCapture(offer, evidence)).status).toBe('restored')
  expect((await getOffer(offer.id))?.offer).toEqual(saved.offer)
  expect(await getEvidence(offer.id)).toEqual(evidence)
  expect(await hasCaptureReceipt(offer.id)).toBe(true)
  await deleteOffer(offer.id)
})
