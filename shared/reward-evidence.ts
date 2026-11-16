import type { Reward } from './schema'

// Several league uniques share this motif. Older imports identified the flask
// from the picture alone; reviewing the reward row did not disambiguate it.
export function needsUniqueTooltipCheck(reward: Reward): boolean {
  return reward.visualId === 'orange-feathers' && reward.tooltipConfirmed !== true
}

export function isRewardIdentified(reward: Reward): boolean {
  return reward.identified && !needsUniqueTooltipCheck(reward)
}
