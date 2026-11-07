import { describe, expect, test } from 'vitest'
import { offerSchema, captureSchema } from '../shared/schema'
import { newOffer, newCard, exampleOffer, captureToDraft, submissionProblem } from '../shared/offers'

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
    const capture = captureSchema.parse({ kind: 'fate-collector.capture', schemaVersion: 1, captureId: crypto.randomUUID(), capturedAt: new Date().toISOString(), source: 'windows-helper', helperVersion: '0.1.0', image: { width: 1, height: 1, mimeType: 'image/png', dataBase64: 'eA==' }, ocr: { status: 'unavailable', text: '', lines: [], language: null } })
    expect(captureToDraft(capture).offer.origin).toBe('test')
    expect(captureToDraft({ ...capture, context: { captureMode: 'game' } }).offer.origin).toBe('live')
    expect(captureToDraft({ ...capture, context: { captureMode: 'fixture' } }).offer.origin).toBe('test')
  })
})
