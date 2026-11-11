import 'fake-indexeddb/auto'
import { afterEach, expect, test, vi } from 'vitest'
import { newCard, newOffer } from '../shared/offers'
import { MAX_ARCHIVE_BYTES, MAX_IMPORT_BYTES, type Evidence } from '../shared/schema'
import { createBackupParts, importJson } from '../src/lib/imports'
import { getEvidence, getOffer, importOffers, readOfferArchive, saveOffer } from '../src/lib/storage'
afterEach(() => vi.unstubAllGlobals())

test('full and metadata backups preserve revisions while reporting unavailable evidence', async () => {
  // Storage transfer contract; actual image decoding is covered in browser regressions.
  vi.stubGlobal('createImageBitmap', async () => ({ width: 1, height: 1, close() {} }))
  const id = crypto.randomUUID()
  const evidence: Evidence = { id, imageDataUrl: 'data:image/png;base64,AAAA', ocrText: 'Original OCR', ocrLines: [], ocrStatus: 'ok', helperVersion: '0.3.3' }
  const first = await saveOffer({ ...newOffer(), captureId: id, cards: [{ ...newCard(), name: 'Alchemist' }], notes: 'Corrected' }, evidence)
  const saved = await saveOffer({ ...first.offer, notes: 'Second revision' }, evidence)
  const missing = await saveOffer({ ...newOffer(), captureId: crypto.randomUUID() }, null)
  for (const full of [false, true]) {
    const builder = createBackupParts(full)
    const report = await readOfferArchive(full, entry => builder.add(entry))
    expect(report).toEqual({ offers: 2, omittedOffers: 0, missingEvidence: full ? 1 : 0, damagedEvidence: 0 })
    const data = JSON.parse(await builder.finish()[0].blob.text())
    expect(data.offers.find((entry: { offer: { id: string } }) => entry.offer.id === saved.offer.id)).toEqual({ offer: saved.offer, evidence: full ? evidence : null })
    expect(data.offers.find((entry: { offer: { id: string } }) => entry.offer.id === missing.offer.id).evidence).toBeNull()
    // Import under a new ID verifies restoration without using the existing database row.
    if (full) {
      const copy = { ...saved.offer, id: crypto.randomUUID(), captureId: crypto.randomUUID() }
      await importOffers([{ offer: copy, evidence: { ...evidence, id: copy.captureId } }])
      expect((await getOffer(copy.id))?.offer).toEqual(copy)
      expect(await getEvidence(copy.captureId)).toEqual({ ...evidence, id: copy.captureId })
    }
  }
})

test('a full entry over 12 MiB remains importable without increasing capture limits', async () => {
  const offer = { ...newOffer(), captureId: crypto.randomUUID(), cards: [{ ...newCard(), modifiers: Array(40).fill('x'.repeat(1000)) }] }
  const evidence: Evidence = { id: offer.captureId, imageDataUrl: `data:image/png;base64,${'A'.repeat(MAX_IMPORT_BYTES - 24)}`, ocrText: '', ocrLines: [], ocrStatus: 'not-run', helperVersion: null }
  const builder = createBackupParts(true)
  builder.add({ offer, evidence })
  builder.add({ offer: newOffer(), evidence: null })
  const parts = builder.finish()
  expect(parts).toHaveLength(2)
  expect(parts[0].blob.size).toBeGreaterThan(MAX_IMPORT_BYTES)
  expect(parts[0].blob.size).toBeLessThanOrEqual(MAX_ARCHIVE_BYTES)
  // This test checks the transfer envelope, not PNG decoding quality.
  vi.stubGlobal('createImageBitmap', async () => ({ width: 1, height: 1, close() {} }))
  try {
    expect((await importJson(await parts[0].blob.text())).entries).toEqual([{ offer, evidence }])
    await expect(importJson(JSON.stringify({ kind: 'fate-collector.capture', padding: 'x'.repeat(MAX_IMPORT_BYTES) }))).rejects.toThrow('12 MiB')
  } finally { vi.unstubAllGlobals() }
})
