import { describe, expect, test } from 'vitest'
import { offerSchema, captureSchema, captureUploadSchema, type Capture } from '../shared/schema'
import { newOffer, newCard, exampleOffer, captureToDraft, submissionProblem } from '../shared/offers'

function helperCapture(): Capture {
  return { kind: 'fate-collector.capture', schemaVersion: 1, captureId: crypto.randomUUID(), capturedAt: new Date().toISOString(), source: 'windows-helper', helperVersion: '0.1.0', image: { width: 1, height: 1, mimeType: 'image/png', dataBase64: 'eA==' }, ocr: { status: 'unavailable', text: '', lines: [], language: null } }
}

describe('observations preserve uncertainty', () => {
  test('empty and partial evidence can be saved without inventing rewards', () => {
    expect(offerSchema.parse(newOffer()).cards).toEqual([])
    const offer = { ...newOffer(), completeness: 'partial', cards: [newCard()] }
    expect(offerSchema.parse(offer).cards[0].tier).toBeNull()
    expect(offerSchema.parse(offer).cards[0].rewards).toEqual([])
  })
  test('a complete offer requires a manual review and named cards', () => {
    expect(offerSchema.safeParse({ ...newOffer(), completeness: 'complete', reviewed: true }).success).toBe(false)
    expect(offerSchema.safeParse({ ...exampleOffer(), completeness: 'complete' }).success).toBe(false)
    expect(offerSchema.safeParse({ ...exampleOffer(), completeness: 'complete', reviewed: true }).success).toBe(true)
  })
  test('selected cards must belong to the offer and duplicate IDs are rejected', () => {
    const offer = exampleOffer()
    expect(offerSchema.safeParse({ ...offer, selectedCardId: crypto.randomUUID() }).success).toBe(false)
    expect(offerSchema.safeParse({ ...offer, cards: [offer.cards[0], offer.cards[0]] }).success).toBe(false)
  })
  test('showcase examples cannot become live statistics', () => {
    expect(offerSchema.safeParse({ ...exampleOffer(), origin: 'live' }).success).toBe(false)
    expect(submissionProblem(exampleOffer())).toContain('Test')
  })
  test('a server submission cannot contain screenshots or unrelated fields', () => {
    expect(offerSchema.safeParse({ ...newOffer(), imageDataUrl: 'data:image/png;base64,eA==' }).success).toBe(false)
  })
  test('helper fixtures default to test, real game provenance defaults to live', () => {
    const capture = captureSchema.parse(helperCapture())
    expect(captureToDraft(capture).offer).toMatchObject({ origin: 'test' })
    expect(captureToDraft(capture).offer).not.toHaveProperty('captureContext')
    expect(captureToDraft({ ...capture, context: { captureMode: 'game' } }).offer.origin).toBe('live')
    expect(captureToDraft({ ...capture, context: { captureMode: 'fixture' } }).offer.origin).toBe('test')
  })
  test('helper context remains separate from encounter and game data', () => {
    const capture = helperCapture()
    const context = {
      captureMode: 'game',
      session: { id: crypto.randomUUID(), startedAt: '2026-11-08T18:00:00+01:00', sequence: 8 },
      possibleDuplicate: { ofCaptureId: crypto.randomUUID(), reason: 'same-ocr-within-15s' },
    }
    const { offer } = captureToDraft(captureSchema.parse({ ...capture, context }))
    expect(offerSchema.parse(offer)).toMatchObject({ captureContext: context, encounterNumber: 1, area: '', areaLevel: null, gameVersion: 'unknown' })
  })
  test('capture files, uploads and offers reject malformed context and self-references', () => {
    const capture = helperCapture()
    const upload = { ...capture, kind: 'fate-collector.upload', image: { width: 1, height: 1 } }
    const { offer } = captureToDraft(capture)
    const session = { id: crypto.randomUUID(), startedAt: capture.capturedAt, sequence: 1 }
    const invalid = [
      { session: { ...session, id: 'invalid' } },
      { session: { ...session, startedAt: '2026-11-08T18:00:00' } },
      { session: { ...session, sequence: 0 } },
      { session: { ...session, sequence: 1.5 } },
      { session: { ...session, sequence: 1_000_000_001 } },
      { session: { ...session, area: 'Unexpected' } },
      { possibleDuplicate: { ofCaptureId: 'invalid', reason: 'same-ocr-within-15s' } },
      { possibleDuplicate: { ofCaptureId: capture.captureId.toUpperCase(), reason: 'same-ocr-within-15s' } },
      { possibleDuplicate: { ofCaptureId: crypto.randomUUID(), reason: 'unknown' } },
    ]
    for (const fields of invalid) {
      const context = { captureMode: 'game', ...fields }
      expect(captureSchema.safeParse({ ...capture, context }).success, JSON.stringify(fields)).toBe(false)
      expect(captureUploadSchema.safeParse({ ...upload, context }).success, JSON.stringify(fields)).toBe(false)
      expect(offerSchema.safeParse({ ...offer, captureContext: context }).success, JSON.stringify(fields)).toBe(false)
    }
  })
})
