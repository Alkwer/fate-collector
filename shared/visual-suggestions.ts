import type { Capture, FateCard, Reward } from './schema'
import { newReward } from './offers'
import { findOfferedRegion, knownFateName } from './recognition'
import type { VisualAnalysis } from './visual-recognition'
import { REWARD_CATALOG_VERSION, visualRewardFields } from './reward-catalog'

export const VISUAL_LABELS: Record<NonNullable<Reward['visualId']>, string> = {
  'blue-diamond': 'Blue diamond', 'gold-stack': 'Gold stack', 'gold-grid': 'Gold grid',
  'gold-ring': 'Gold ring', 'silver-cluster': 'Silver cluster', 'orange-feathers': 'Orange feathers',
  'three-gems': 'Three gems', 'gold-axe': 'Gold axe',
}

// Only freshly extracted cards enter here. Never reapply suggestions over a saved
// or corrected offer; imports/storage already preserve the existing revision.
export function applyVisualSuggestions(cards: FateCard[], capture: Capture, result: VisualAnalysis): FateCard[] {
  if (result.status !== 'candidates') return cards
  const headers = findOfferedRegion(capture)?.headers.filter(header => knownFateName(header.text)) ?? []
  if (headers.length !== cards.length) return cards
  return cards.map((card, index) => {
    const header = headers[index]
    const matches = result.cards.filter(candidate => candidate.name === card.name && candidate.header.x === header.x && candidate.header.y === header.y)
    if (matches.length !== 1) return card
    const candidate = matches[0]
    const rewards = candidate.symbols.flatMap(symbol => {
      if (!Object.hasOwn(VISUAL_LABELS, symbol.visualId)) return []
      const visualId = symbol.visualId as NonNullable<Reward['visualId']>
      return [{ ...newReward(), visualId, label: VISUAL_LABELS[visualId], ...visualRewardFields(visualId) }]
    })
    if (candidate.tier === null && !rewards.length) return card
    return { ...card, tier: candidate.tier, rewards, visualReview: {
      version: `${result.version}/${REWARD_CATALOG_VERSION}`, tierReviewed: candidate.tier === null, rewardsReviewed: false,
    } }
  })
}
