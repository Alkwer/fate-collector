import { cardSchema, type FateCard } from '../../shared/schema'

export function cardNeedsReview(card: FateCard): boolean {
  return !cardSchema.safeParse(card).success || !card.name.trim() || card.tier === null
    || !card.rewards.length || card.rewards.some(reward => !reward.identified || reward.kind === 'unknown'
      || (reward.kind === 'combo' && reward.threshold === null))
    || !!card.visualReview && (!card.visualReview.tierReviewed || !card.visualReview.rewardsReviewed)
}
