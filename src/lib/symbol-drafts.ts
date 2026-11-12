import type { SymbolDraft } from '../../shared/symbol-drafts'
import { newCard, newOffer } from '../../shared/offers'
import type { Offer } from '../../shared/schema'

export function symbolDraftContext(draft: SymbolDraft, candidate?: Offer | null): { offer: Offer; linked: boolean } {
  if (draft.captureId && candidate?.captureId === draft.captureId && candidate.origin === draft.origin && candidate.cards.length) {
    return { offer: structuredClone(candidate), linked: true }
  }
  // This is an independent research draft, never an inferred/saved game offer.
  return { linked: false, offer: { ...newOffer(), id: draft.id, capturedAt: draft.createdAt,
    captureId: draft.captureId, source: 'windows-helper', origin: draft.origin, gameVersion: 'unknown',
    cards: [newCard()], notes: 'Local symbol report draft; no offer identification.' } }
}
