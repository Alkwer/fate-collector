import { afterEach, expect, test, vi } from 'vitest'
import { z } from 'zod'
import { importJson } from '../src/lib/imports'
import { newOffer } from '../shared/offers'

afterEach(() => vi.unstubAllGlobals())
function capture(helperVersion: string) {
  vi.stubGlobal('createImageBitmap', async () => ({ width: 2, height: 2, close() {} }))
  return { kind: 'fate-collector.capture', schemaVersion: 1, captureId: crypto.randomUUID(), capturedAt: new Date().toISOString(), source: 'windows-helper', helperVersion,
    image: { width: 2, height: 2, mimeType: 'image/png', dataBase64: 'AQ==' }, ocr: { status: 'unavailable', text: '', lines: [], language: null } }
}
test.each(['0.1.0', '0.3.4', '0.4.0', '0.5.0'])('current website preserves v1 helper %s without inventing missing metadata', async version => {
  const raw = capture(version)
  const result = await importJson(JSON.stringify(raw))
  expect(result.entries[0].evidence?.helperVersion).toBe(version)
  expect(result.entries[0].offer.captureContext).toBeUndefined()
  expect(result.entries[0].offer.reviewed).toBe(false)
})
test('new helper fields explain why a pre-area website needs refreshing; current parser preserves the evidence', async () => {
  // Frozen pre-area context contract from main before PR #31 (b1c663b^).
  const legacyContext = z.object({ captureMode: z.enum(['game', 'fixture']), session: z.object({ id: z.string().uuid(), startedAt: z.string().datetime({ offset: true }), sequence: z.number().int().min(1).max(1_000_000_000) }).strict().optional(), possibleDuplicate: z.object({ ofCaptureId: z.string().uuid(), reason: z.literal('same-ocr-within-15s') }).strict().optional() }).strict()
  const raw = { ...capture('0.5.0'), context: { captureMode: 'game', area: { areaId: null, areaLevel: null, category: 'unknown', source: 'client-log' } } }
  expect(legacyContext.safeParse(raw.context).success).toBe(false)
  expect((await importJson(JSON.stringify(raw))).entries[0].offer.captureContext).toEqual(raw.context)
  // Area shape is tested independently; use a forward field to assert a clear
  // update path rather than accepting a partially understood future capture.
  await expect(importJson(JSON.stringify({ ...capture('0.6.0'), context: { captureMode: 'game', futureField: true } }))).rejects.toThrow('refresh Fate Collector')
  await expect(importJson(JSON.stringify({ ...capture('0.6.0'), schemaVersion: 2 }))).rejects.toThrow('Keep the original file')
})
test('older offer backups keep omitted area metadata and their original revision', async () => {
  const { areaCategory: _areaCategory, ...offer } = { ...newOffer(), revision: 7, gameVersion: 'unknown' }
  const result = await importJson(JSON.stringify({ kind: 'fate-collector.export', schemaVersion: 1, offers: [{ offer, evidence: null }] }))
  expect(result.mode).toBe('restore')
  expect(result.entries[0].offer).toEqual(offer)
})
