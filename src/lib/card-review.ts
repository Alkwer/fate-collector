import { cardSchema, type FateCard } from '../../shared/schema'

export function cardNeedsReview(card: FateCard): boolean {
  return !cardSchema.safeParse(card).success || !card.name.trim() || card.tier === null
    || !card.rewards.length || card.rewards.some(reward => !reward.identified || reward.kind === 'unknown'
      || (reward.kind === 'combo' && reward.threshold === null))
    || !!card.visualReview && (!card.visualReview.tierReviewed || !card.visualReview.rewardsReviewed)
}

export function cardReviewReasons(card: FateCard): string[] {
  const reasons: string[] = []
  if (!cardSchema.safeParse(card).success) reasons.push('Correct invalid fields')
  if (!card.name.trim()) reasons.push('Read the Fate name')
  if (card.tier === null) reasons.push('Identify the tier')
  else if (card.visualReview && !card.visualReview.tierReviewed) reasons.push('Check the suggested tier')
  if (!card.rewards.length) reasons.push('Read the reward row')
  if (card.rewards.some(reward => !reward.identified || reward.kind === 'unknown')) reasons.push('Identify unknown rewards')
  if (card.rewards.some(reward => reward.kind === 'combo' && reward.threshold === null)) reasons.push('Check the combo threshold')
  if (card.rewards.length && card.visualReview && !card.visualReview.rewardsReviewed) reasons.push('Check the full reward row')
  return reasons
}
