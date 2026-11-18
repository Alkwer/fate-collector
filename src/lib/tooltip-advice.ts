import { type InvocationLimit, MERGED_REGULAR_MULTIPLIER, normalizeRewardLabel, recommendFates, supportsDuplicateCombo, type AdvisorGoal, type InvocationPlan, type Recommendation } from '../../shared/advisor'
import { normalizeFateName } from '../../shared/fate-names'
import { assessPlanningCard } from '../../shared/planning-filters'
import { catalogFields, KNOWN_COMBOS, type CatalogReward } from '../../shared/reward-catalog'
import { isRewardIdentified } from '../../shared/reward-evidence'
import type { FateCard, Reward } from '../../shared/schema'
import { recommendPortfolio, type SolverPortfolio, type SolverProfile } from '../../shared/solver'
import { VISUAL_LABELS } from '../../shared/visual-suggestions'
import { profitObjectives, profitRewardLabels, type LeagueGoal } from './league-challenges'
import { iconVariants, suggestedIconGroup } from './reward-icon-lookup'

type Ranking =
  | { mode: 'portfolio'; result: SolverPortfolio }
  | { mode: 'single'; goal: AdvisorGoal; result: Recommendation }

interface TooltipAdviceInputs {
  offered: FateCard[]
  collected: FateCard[]
  profile: SolverProfile
  excludedCardIds: string[]
  limit?: InvocationLimit
  lastOffer?: boolean
  ranking: Ranking | null
  leagueGoal?: LeagueGoal
}

type TooltipSlot = { card: FateCard; location: string; reward: Reward; group: string }
type KnownVariant = CatalogReward & { kind: AdvisorGoal['kind'] }

const goalKey = (goal: AdvisorGoal) => `${goal.kind}:${normalizeRewardLabel(goal.label)}`
const planScore = (plan: InvocationPlan | null | undefined) =>
  plan ? Math.min(plan.targetCount, plan.threshold ?? plan.targetCount) : 0
const isKnownVariant = (variant: CatalogReward): variant is KnownVariant => variant.kind !== 'unknown'

const variantsByGroup = new Map<string, Map<string, KnownVariant>>()
for (const row of iconVariants) {
  const group = variantsByGroup.get(row.group) ?? new Map<string, KnownVariant>()
  for (const variant of row.matches) {
    if (isKnownVariant(variant)) group.set(goalKey(variant), variant)
  }
  variantsByGroup.set(row.group, group)
}

function matchingCount(card: FateCard, variant: KnownVariant) {
  return card.rewards.reduce((count, reward) => isRewardIdentified(reward) && reward.kind === variant.kind
    && normalizeRewardLabel(reward.label) === normalizeRewardLabel(variant.label) ? count + reward.count : count, 0)
}

function conflictingThreshold(cards: FateCard[], variant: KnownVariant) {
  if (variant.kind !== 'combo') return false
  return KNOWN_COMBOS.some(combo => goalKey(combo) === goalKey(variant) && combo.threshold !== variant.threshold)
    || cards.some(card => card.rewards.some(reward =>
    isRewardIdentified(reward) && reward.kind === 'combo' && reward.threshold !== null
    && reward.threshold !== variant.threshold && normalizeRewardLabel(reward.label) === normalizeRewardLabel(variant.label)))
}

function closesDistinctCombo(slot: TooltipSlot, collected: FateCard[], variant: KnownVariant, limit: InvocationLimit) {
  if (variant.kind !== 'combo' || slot.reward.count !== 1) return false
  const byName = new Map<string, number>()
  const offeredName = normalizeFateName(slot.card.name)
  // Only model distinct Fates here. A matching name can change which icons survive.
  if (offeredName) for (const card of collected) {
    const name = normalizeFateName(card.name)
    if (name && name !== offeredName) byName.set(name, Math.max(byName.get(name) ?? 0, matchingCount(card, variant)))
  }
  const counts = [...byName.values()].sort((a, b) => b - a).slice(0, limit - 1)
  return matchingCount(slot.card, variant) + counts.reduce((sum, count) => sum + count, 0) === variant.threshold - 1
}

function profitTooltip(goal: NonNullable<LeagueGoal>, slots: TooltipSlot[], offered: FateCard[], collected: FateCard[], limit: InvocationLimit) {
  if (goal.kind !== 'profit') return null
  const objective = profitObjectives.find(row => row.id === goal.objective)
  if (!objective) return null
  const labels = profitRewardLabels(goal.objective)
  const eligibleCards = [...offered, ...collected]
  let identification: string | null = null
  for (const slot of slots) {
    for (const variant of variantsByGroup.get(slot.group)?.values() ?? []) {
      if (!labels.has(normalizeRewardLabel(variant.label))) continue
      const prompt = `Hover ${slot.location} for ${variant.label}`
      if (!conflictingThreshold(eligibleCards, variant) && closesDistinctCombo(slot, collected, variant, limit)) {
        return `${prompt}. A match could complete the Promised Profits combo.`
      }
      identification ??= `${prompt} (Promised Profits).`
    }
    // Some named objectives share the artwork and have wording in PoEDB only.
    // That establishes a possible identity, without a kind or threshold.
    const exact = objective.rewards.length === 1 && objective.rewards[0]
    if (exact && iconVariants.some(row => row.group === slot.group
      && normalizeRewardLabel(row.description) === `empowered monster will drop ${normalizeRewardLabel(exact)}`)) {
      identification ??= `Hover ${slot.location} for ${exact} (Promised Profits).`
    }
  }
  return identification
}

// Only try a few one-icon counterfactuals. The overlay already compares the
// offer and caches that result by context. Each test reuses the current cards
// and substitutes an interpretation solely in the hypothetical calculation.
const MAX_SIMULATIONS = 3

function tooltipSlots(card: FateCard, index: number): TooltipSlot[] {
  const reviewedOrder = card.visualReview?.rewardsReviewed && card.rewards.every(reward => reward.count === 1 && reward.visualId)
  const number = `#${index + 1}`
  return card.rewards.flatMap((reward, rewardIndex) => {
    const group = suggestedIconGroup(reward.visualId)
    if (!reward.visualId || !group || (isRewardIdentified(reward) && reward.kind !== 'unknown')) return []
    // Recognition sorts exposed symbols from left to right but may miss icons.
    // Give a physical position only once the entire row has been checked.
    if (reviewedOrder) return [{ card, reward, group, location: `${number}, icon ${rewardIndex + 1} from the left` }]
    if (card.rewards.filter(other => other.visualId === reward.visualId).length !== 1) return []
    return [{ card, reward, group, location: `${number}'s ${VISUAL_LABELS[reward.visualId].toLowerCase()} icon` }]
  })
}

function canReachThreshold(slot: TooltipSlot, collected: FateCard[], variant: KnownVariant) {
  if (variant.kind !== 'combo') return true
  const pool = [slot.card, ...collected]
  const count = 1 + pool.reduce((sum, card) => sum + matchingCount(card, variant), 0)
  const multiplier = pool.some(card => supportsDuplicateCombo(card, variant.label, variant.threshold)) ? MERGED_REGULAR_MULTIPLIER : 1
  return count * multiplier >= variant.threshold
}

export function tooltipAdvice({ offered, collected, profile, excludedCardIds, lastOffer, ranking, leagueGoal, limit = 3 }: TooltipAdviceInputs): string | null {
  const filters = { ...profile, excludedCardIds }
  const excluded = new Set(ranking?.result.excluded?.map(card => card.cardId))
  const eligible = (card: FateCard) => !excluded.has(card.id) && !assessPlanningCard(card, filters).excluded
  const eligibleCollected = collected.filter(eligible)
  const collectedIds = new Set(collected.map(card => card.id))
  const eligibleOffered = offered.filter(card => !collectedIds.has(card.id) && eligible(card))
  const eligibleIds = new Set(eligibleOffered.map(card => card.id))
  const slots = offered.flatMap((card, index) => eligibleIds.has(card.id) ? tooltipSlots(card, index) : [])
  if (!slots.length) return null

  const challenge = leagueGoal ? profitTooltip(leagueGoal, slots, eligibleOffered, eligibleCollected, limit) : null
  if (challenge) return challenge
  if (!ranking || profile.objective === 'viscera' || !ranking.result.candidates.length) return null

  const weights = new Map((ranking.mode === 'single' ? [{ ...ranking.goal, weight: 1 }] : profile.goals)
    .filter(goal => goal.weight > 0).map(goal => [goalKey(goal), goal.weight]))
  const scores = new Map(ranking.mode === 'single'
    ? ranking.result.candidates.map(candidate => [candidate.cardId, planScore(candidate.plan)])
    : ranking.result.candidates.map(candidate => [candidate.cardId, candidate.plan?.score ?? 0]))
  const baseline = ranking.mode === 'single' ? planScore(ranking.result.baseline) : ranking.result.baseline?.score ?? 0
  const bestKnown = Math.max(baseline, ...scores.values())
  const leaders = ranking.mode === 'single' ? ranking.result.recommendedCardIds
    : [...scores].filter(([, score]) => score === bestKnown).map(([id]) => id)
  const leader = leaders.length === 1 && bestKnown > baseline ? leaders[0] : undefined
  const eligibleCards = [...eligibleOffered, ...eligibleCollected]
  const shortlisted = new Set<string>()
  const trials = slots.flatMap(slot => {
    if (slot.card.id === leader || slot.reward.count !== 1 || !scores.has(slot.card.id)) return []
    return [...(variantsByGroup.get(slot.group)?.values() ?? [])].flatMap(variant => {
      const key = goalKey(variant)
      const weight = weights.get(key)
      const trialKey = `${slot.card.id}:${key}`
      if (!weight || shortlisted.has(trialKey) || conflictingThreshold(eligibleCards, variant)) return []
      // A summary bound is enough to skip variants which cannot beat the
      // score on display, even with the supported duplicate multiplier.
      const improvement = ranking.mode === 'portfolio' && variant.kind === 'combo' ? weight
        : weight * MERGED_REGULAR_MULTIPLIER
      const ceiling = scores.get(slot.card.id)! + improvement
      if (ceiling <= bestKnown || (ranking.mode === 'portfolio' || lastOffer)
        && !canReachThreshold(slot, eligibleCollected, variant)) return []
      shortlisted.add(trialKey)
      return [{ slot, variant, ceiling }]
    })
  }).sort((a, b) => b.ceiling - a.ceiling)

  for (const { slot, variant } of trials.slice(0, MAX_SIMULATIONS)) {
    const hypothetical = offered.map(card => card !== slot.card ? card : {
      ...card,
      rewards: card.rewards.map(reward => reward !== slot.reward ? reward
        : { ...reward, ...catalogFields(variant), tooltipConfirmed: true }),
    })
    let putsCardAhead: boolean
    let activatesCombo: boolean
    if (ranking.mode === 'single') {
      const result = recommendFates(hypothetical, collected, ranking.goal, filters, lastOffer, limit)
      const candidate = result.candidates.find(card => card.cardId === slot.card.id)
      const score = planScore(candidate?.plan)
      putsCardAhead = score > bestKnown && result.recommendedCardIds.length === 1 && result.recommendedCardIds[0] === slot.card.id
        && result.candidates.every(card => card.cardId === slot.card.id || planScore(card.plan) < score)
      activatesCombo = candidate?.plan?.activated === true
    } else {
      // The decision compares payable scores. Skip future projections even if
      // this offer isn't the last, as projections cannot change those scores.
      const result = recommendPortfolio(hypothetical, collected, profile, excludedCardIds, true, limit)
      const candidate = result.candidates.find(card => card.cardId === slot.card.id)
      const score = candidate?.plan?.score ?? 0
      putsCardAhead = score > bestKnown && score > (result.baseline?.score ?? 0)
        && result.candidates.every(card => card.cardId === slot.card.id || (card.plan?.score ?? 0) < score)
      activatesCombo = candidate?.plan?.rewards.some(reward =>
        reward.kind === 'combo' && normalizeRewardLabel(reward.label) === normalizeRewardLabel(variant.label)
        && reward.activated && !reward.uncertain) === true
    }
    if (putsCardAhead) {
      const prompt = `Hover ${slot.location} for ${variant.label}.`
      if (activatesCombo) return `${prompt} That combo could put this card ahead.`
      if (variant.kind === 'combo') return `${prompt} A match could put this card ahead on combo progress.`
      return `${prompt} A match could put this card ahead.`
    }
  }
  return null
}
