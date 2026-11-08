import type { Evidence, FateCard, Offer, Reward, Capture } from './schema'

export function newReward(): Reward {
  return { id: crypto.randomUUID(), label: '', kind: 'unknown', count: 1, threshold: null, identified: false }
}
export function newCard(): FateCard {
  return { id: crypto.randomUUID(), name: '', tier: null, modifiers: [], rewards: [] }
}
export function newOffer(): Offer {
  const now = new Date().toISOString()
  return { kind: 'fate-collector.offer', schemaVersion: 1, id: crypto.randomUUID(), revision: 1, capturedAt: now, updatedAt: now,
    captureId: null, source: 'manual', origin: 'test', gameVersion: '3.30 preview', area: '', areaLevel: null,
    encounterNumber: 1, completeness: 'unverified', reviewed: false, cards: [], selectedCardId: null, notes: '' }
}
export function exampleOffer(): Offer {
  return { ...newOffer(), source: 'example', cards: ['Alchemist', 'Sanguine'].map(name => ({ ...newCard(), name, tier: 1, rewards: [newReward()] })),
    notes: 'Illustrative partial offer based on pre-release card names. Reward icons have not been identified. This is not an observed complete roll.' }
}
export function captureToDraft(capture: Capture): { offer: Offer; evidence: Evidence } {
  return {
    offer: { ...newOffer(), id: capture.captureId, captureId: capture.captureId, capturedAt: capture.capturedAt, source: 'windows-helper',
      ...(capture.context && { captureContext: capture.context }),
      origin: capture.context?.captureMode === 'game' ? 'live' : 'test', gameVersion: capture.context?.captureMode === 'game' ? 'unknown' : '3.30 preview' },
    evidence: { id: capture.captureId, imageDataUrl: `data:image/png;base64,${capture.image.dataBase64}`, ocrText: capture.ocr.text,
      ocrLines: capture.ocr.lines, ocrStatus: capture.ocr.status, helperVersion: capture.helperVersion },
  }
}

// A reviewed offer can still contain unidentified icons; completeness describes coverage,
// not recognition quality. Downstream statistics must select the appropriate cohort.
export function submissionProblem(offer: Offer): string | null {
  if (offer.origin !== 'live' || offer.source === 'example') return 'Test and showcase offers cannot be submitted as game observations.'
  if (!offer.reviewed) return 'Review the offer before sharing it.'
  if (!offer.gameVersion.trim()) return 'Enter the game version before sharing.'
  if (!offer.cards.length) return 'Add the cards you could read before sharing.'
  if (offer.completeness === 'unverified') return 'Mark the offer as complete or partial before sharing.'
  return null
}
