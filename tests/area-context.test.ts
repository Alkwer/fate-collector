import { expect, test } from 'vitest'
import { captureSchema, captureUploadSchema, offerSchema, type Capture } from '../shared/schema'
import { captureToDraft, newOffer } from '../shared/offers'
import { capturedAreaFields } from '../shared/area-context'

const area = { source: 'client-log', category: 'campaign', areaId: '1_1_1', areaLevel: 1 } as const
function capture(): Capture {
  return { kind: 'fate-collector.capture', schemaVersion: 1, captureId: crypto.randomUUID(), capturedAt: new Date().toISOString(), source: 'windows-helper', helperVersion: '0.5.0', context: { captureMode: 'game', area },
    image: { width: 1, height: 1, mimeType: 'image/png', dataBase64: 'eA==' }, ocr: { status: 'unavailable', text: '', lines: [], language: null } }
}

test('native context initializes editable fields and preserves its original classification', () => {
  const { offer } = captureToDraft(captureSchema.parse(capture()))
  expect(offer).toMatchObject({ areaCategory: 'campaign', area: '1_1_1', areaLevel: 1, captureContext: { area } })
  const corrected = offerSchema.parse({ ...offer, areaCategory: 'map' })
  expect(corrected.areaCategory).toBe('map')
  expect(corrected.captureContext?.area).toEqual(area)
})

test('legacy, fixture and unavailable context stay unknown without guessing from area level', () => {
  const { areaCategory: omitted, ...legacy } = newOffer()
  expect(offerSchema.parse({ ...legacy, area: 'The Coast', areaLevel: 83 }).areaCategory).toBeUndefined()
  expect(capturedAreaFields(undefined)).toEqual({ areaCategory: 'unknown', area: '', areaLevel: null })
  expect(capturedAreaFields({ captureMode: 'fixture', area })).toEqual({ areaCategory: 'unknown', area: '', areaLevel: null })
  expect(captureSchema.safeParse({ ...capture(), context: { captureMode: 'fixture', area } }).success).toBe(false)
  expect(capturedAreaFields({ captureMode: 'game', area: { source: 'client-log', category: 'unknown', areaId: null, areaLevel: null } }).areaCategory).toBe('unknown')
})

test('capture and upload contracts allow only bounded area metadata, never raw logs or paths', () => {
  const sample = capture()
  const upload = { ...sample, kind: 'fate-collector.upload', image: { width: 1, height: 1 } }
  expect(captureUploadSchema.parse(upload).context.area).toEqual(area)
  for (const invalid of [
    { ...area, category: 'endgame' }, { ...area, source: 'memory' },
    { ...area, areaId: '../Client.txt' }, { ...area, areaId: 'x'.repeat(161) },
    { ...area, areaLevel: 0 }, { ...area, areaLevel: 101 }, { ...area, areaLevel: 1.5 },
    { ...area, areaId: null }, { ...area, areaLevel: null },
    { ...area, path: 'C:/Game/logs/Client.txt' }, { ...area, raw: 'private chat' },
  ]) {
    const context = { captureMode: 'game', area: invalid }
    expect(captureSchema.safeParse({ ...sample, context }).success).toBe(false)
    expect(captureUploadSchema.safeParse({ ...upload, context }).success).toBe(false)
  }
  expect(offerSchema.safeParse({ ...newOffer(), areaCategory: 'invalid' }).success).toBe(false)
})
