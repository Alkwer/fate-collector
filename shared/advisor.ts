import { cardSchema, rewardSchema, type FateCard } from './schema'
import { normalizeFateName } from './fate-names'
import { KNOWN_COMBOS, VALUABLE_CURRENCY_LABEL } from './reward-catalog'
import { isRewardIdentified, needsUniqueTooltipCheck } from './reward-evidence'
import { assessPlanningCard, assessPlanningMerge, mergeOutputTier, type PlanningFilters } from './planning-filters'
export { KNOWN_COMBOS } from './reward-catalog'

export type AdvisorGoal = { kind: 'regular' | 'combo'; label: string }

export const MAX_COLLECTED_FATES = 12
export const MAX_OFFERED_FATES = 30
export const MERGED_REGULAR_MULTIPLIER = 3
export const TRIPLED_REGULAR_MULTIPLIER = 3

export type InvocationPlan = {
  cardIds: string[]
  targetCount: number
  threshold: number | null
  activated: boolean
  merges: { firstId: string; consumedId: string; outputTier: 2 | 3 }[]
  triples?: { firstId: string; consumedId: string; thirdId: string }[]
  duplicateCurrency?: { label: string; count: number; threshold: number }[]
  warnings: string[]
}

export type PlanResult = {
  status: 'ready' | 'provisional' | 'insufficient'
  plans: InvocationPlan[]
  warnings: string[]
  collectingPlans?: InvocationPlan[]
  excluded?: { cardId: string; reasons: string[] }[]
}

export type Recommendation = {
  status: PlanResult['status']
  comparison: 'improvement' | 'no-improvement' | 'unknown'
  baseline: InvocationPlan | null
  recommendedCardIds: string[]
  candidates: { cardId: string; plan: InvocationPlan | null; gain: number | null; warnings: string[] }[]
  warnings: string[]
  excluded?: { cardId: string; reasons: string[] }[]
}

export const MAX_INVOCATION_INPUTS = 3
export type InvocationLimit = 2 | 3

export function invocationLimit(areaCategory?: string): InvocationLimit {
  return areaCategory === 'campaign' ? 2 : MAX_INVOCATION_INPUTS
}

const COMBAT_WARNING = 'Combat difficulty remains unassessed. Build filters flag only selected effects.'
const NO_PROGRESS = 'No positive result could be established for this goal.'
export const UNKNOWN_FATE_NAME = 'A Fate name is missing, so possible duplicate interactions are unresolved.'
export const UNRESOLVED_COMBO_MERGE = 'Combo behavior after merging duplicate Fates is unresolved.'
export const UNRESOLVED_COMBO_TRIPLE = 'Combo behavior after invoking three copies of the same Fate is unresolved.'
export const UNRESOLVED_TRIPLE_RISK = 'Three-copy output tier and its additional effects are unverified. Check the final effects in game.'

function cleanLabel(label: string): string {
  return label.normalize().trim().replace(/\s+/g, ' ').replace(/[\u2018\u2019\u201B\u02BC\uFF07]/g, "'")
}

export function normalizeRewardLabel(label: string): string {
  return cleanLabel(label).toLowerCase()
}

// The Armoury and Conjurer previews show Currency activation. The invocation
// order search enforces matching names and checked tiers before applying this.
export function supportsDuplicateCombo(card: FateCard, label: string, threshold: number | null): boolean {
  if (card.tier !== 2 || !card.name.trim()) return false
  const key = normalizeRewardLabel(label)
  if (!(key === VALUABLE_CURRENCY_LABEL.toLowerCase() && threshold === 3)
    && !(key === 'additional currency items' && threshold === 2)) return false
  const matches = card.rewards.filter(reward => reward.kind === 'combo' && isRewardIdentified(reward)
    && normalizeRewardLabel(reward.label) === key)
  return matches.length === 0 || (matches.length === 1 && matches[0].count === 1 && card.visualReview?.rewardsReviewed !== false)
}

export function getAdvisorGoals(cards: FateCard[]): AdvisorGoal[] {
  const regular = new Map<string, AdvisorGoal>()
  const combo = new Map<string, AdvisorGoal>(KNOWN_COMBOS.map(({ label }) => [normalizeRewardLabel(label), { kind: 'combo', label }]))
  for (const card of cards) {
    for (const reward of card.rewards) {
      if (!isRewardIdentified(reward) || reward.kind === 'unknown') continue
      const label = cleanLabel(reward.label)
      const key = normalizeRewardLabel(label)
      const goals = reward.kind === 'regular' ? regular : combo
      if (key && !goals.has(key)) goals.set(key, { kind: reward.kind, label })
    }
  }
  return [...regular.values(), ...combo.values()]
}

export function advisorInputProblem(cards: FateCard[], limit: number, group: string): string | null {
  if (!Array.isArray(cards) || cards.length > limit) return `Use at most ${limit} ${group} Fates.`
  const cardIds = new Set<string>()
  for (const card of cards) {
    if (!card || typeof card.id !== 'string' || !card.id.trim() || cardIds.has(card.id)) {
      return `Use unique card IDs for ${group} Fates.`
    }
    cardIds.add(card.id)
    if (typeof card.name !== 'string' || !cardSchema.shape.tier.safeParse(card.tier).success || !Array.isArray(card.rewards)
      || !cardSchema.shape.modifiers.safeParse(card.modifiers).success || !cardSchema.shape.visualReview.safeParse(card.visualReview).success) {
      return `Check the names, tiers and reward lists of the ${group} Fates.`
    }
    const rewardIds = new Set<string>()
    for (const reward of card.rewards) {
      if (!reward || typeof reward.id !== 'string' || !reward.id.trim() || rewardIds.has(reward.id)) {
        return 'Use unique reward IDs within each Fate.'
      }
      rewardIds.add(reward.id)
      if (typeof reward.label !== 'string' || typeof reward.identified !== 'boolean'
        || !rewardSchema.shape.kind.safeParse(reward.kind).success
        || !rewardSchema.shape.count.safeParse(reward.count).success
        || !rewardSchema.shape.threshold.safeParse(reward.threshold).success) {
        return `Check the reward kinds, counts and thresholds of the ${group} Fates.`
      }
    }
  }
  return null
}

function validGoal(goal: AdvisorGoal): boolean {
  return !!goal && (goal.kind === 'regular' || goal.kind === 'combo')
    && typeof goal.label === 'string' && !!normalizeRewardLabel(goal.label)
}

type GoalCard = {
  original: FateCard
  id: string
  name: string
  tier: number | null
  tierReviewed: boolean
  targetCount: number
  warnings: string[]
}

type InvocationInput = Pick<GoalCard, 'name' | 'tier' | 'tierReviewed'>

export function visitInvocationOrders<Card extends InvocationInput>(
  cards: Card[],
  required: Card | undefined,
  addPlan: (active: Card[], pair?: [Card, Card], triple?: [Card, Card, Card]) => void,
  warn: (warning: string) => void,
  limit: InvocationLimit = MAX_INVOCATION_INPUTS,
): void {
  function consider(selected: Card[]) {
    if (selected.length > 1 && selected.some(card => !card.name)) {
      warn(UNKNOWN_FATE_NAME)
      return
    }
    const duplicate = selected.find((card, i) => selected.slice(i + 1).some(other => other.name === card.name))
    if (!duplicate) {
      addPlan(selected)
      return
    }
    const copies = selected.filter(card => card.name === duplicate.name)
    if (copies.length > 2) {
      const [first, second, third] = copies
      if (first.tier === null || copies.some(card => card.tier !== first.tier)) {
        warn('Invoking three copies of the same Fate with mixed or unknown tiers is unresolved.')
      } else if (copies.some(card => !card.tierReviewed)) {
        warn('Check the suggested tiers before invoking three copies of the same Fate.')
      } else {
        // Interchanging the first and third Fates gives the same rewards.
        // Evaluate each possible middle Fate once.
        addPlan([], undefined, [first, second, third])
        addPlan([], undefined, [second, first, third])
        addPlan([], undefined, [first, third, second])
      }
    } else if (copies[0].tier !== copies[1].tier || mergeOutputTier(copies[0].tier) === null) {
      warn('Only pairs of the same Fate with matching Tier 1 or Tier 2 have a confirmed merge.')
    } else if (copies.some(card => !card.tierReviewed)) {
      warn('Check the suggested tiers before relying on a duplicate merge.')
    } else {
      const [first, second] = copies
      const others = selected.filter(card => card.name !== duplicate.name)
      // Only the order of the pair changes the outcome. Keep the merged pair
      // together before the remaining Fate, as shown in the prerelease demo.
      addPlan(others, [first, second])
      addPlan(others, [second, first])
    }
  }

  function visit(selected: Card[], start: number) {
    if (selected.length) consider(selected)
    if (selected.length === limit) return
    for (let index = start; index < cards.length; index += 1) {
      visit([...selected, cards[index]], index + 1)
    }
  }

  visit(required ? [required] : [], 0)
}

function analyzeGoal(cards: FateCard[], goal: AdvisorGoal) {
  const goalLabel = normalizeRewardLabel(goal.label)
  const thresholds = new Set<number>()
  if (goal.kind === 'combo') {
    const known = KNOWN_COMBOS.find(combo => normalizeRewardLabel(combo.label) === goalLabel)
    if (known) thresholds.add(known.threshold)
  }

  const goalCards: GoalCard[] = cards.map(card => {
    const name = normalizeFateName(card.name)
    const warnings = new Set<string>()
    if (!name) warnings.add(UNKNOWN_FATE_NAME)
    if (!card.rewards.length) warnings.add('At least one Fate has no recorded rewards.')
    if (card.visualReview && !card.visualReview.rewardsReviewed) warnings.add('Visual suggestions may miss reward icons. Check the full reward row before relying on this ranking.')
    let targetCount = 0
    for (const reward of card.rewards) {
      const label = normalizeRewardLabel(reward.label)
      if (needsUniqueTooltipCheck(reward)) {
        warnings.add('A shared league-unique icon needs its exact tooltip checked before it can score.')
        continue
      }
      if (reward.kind === 'unknown' || (reward.kind === goal.kind && (!isRewardIdentified(reward) || !label))) {
        warnings.add('An unidentified reward or reward kind could match this goal.')
        continue
      }
      if (reward.kind !== goal.kind || label !== goalLabel) continue
      targetCount += reward.count
      if (goal.kind === 'combo' && reward.threshold !== null) thresholds.add(reward.threshold)
    }
    return { original: card, id: card.id, name, tier: card.tier, tierReviewed: card.visualReview?.tierReviewed ?? true, targetCount, warnings: [...warnings] }
  })

  const warnings: string[] = []
  const threshold = thresholds.size === 1 ? [...thresholds][0] : null
  if (goal.kind === 'combo' && threshold === null) {
    warnings.push(thresholds.size ? 'Conflicting thresholds leave combo activation unresolved.' : 'The combo threshold is unknown.')
  }
  return { cards: goalCards, threshold, warnings }
}

function score(plan: InvocationPlan): number {
  return plan.threshold === null ? plan.targetCount : Math.min(plan.targetCount, plan.threshold)
}

function comparePlans(a: InvocationPlan, b: InvocationPlan): number {
  return score(b) - score(a) || a.cardIds.length - b.cardIds.length
}

function searchPlans(cards: GoalCard[], goal: AdvisorGoal, threshold: number | null, goalWarnings: string[], required: GoalCard | undefined, filters: PlanningFilters, invoking: boolean, limit: InvocationLimit) {
  const plans: InvocationPlan[] = []
  const warnings = new Set(goalWarnings)

  function addPlan(active: GoalCard[], pair?: [GoalCard, GoalCard], triple?: [GoalCard, GoalCard, GoalCard]) {
    const mergeRisk = pair ? assessPlanningMerge(pair[0].original, filters) : null
    if (mergeRisk?.excluded) {
      for (const reason of mergeRisk.reasons) warnings.add(`Merged plan excluded: ${reason}`)
      return
    }
    const retainedCopies = triple ? [triple[0], triple[2]] : pair ? [pair[0]] : []
    if (goal.kind === 'combo' && retainedCopies.some(card => !supportsDuplicateCombo(card.original, goal.label, threshold))) {
      warnings.add(triple ? UNRESOLVED_COMBO_TRIPLE : UNRESOLVED_COMBO_MERGE)
      return
    }
    const retainedCount = retainedCopies.reduce((sum, card) => sum + card.targetCount, 0)
    const targetCount = active.reduce((sum, card) => sum + card.targetCount, 0)
      + retainedCount * (triple ? TRIPLED_REGULAR_MULTIPLIER : MERGED_REGULAR_MULTIPLIER)
    const retained = [...retainedCopies, ...active]
    const tripleWarnings = triple && (filters.avoidModifiers?.length || Object.values(filters.risks ?? {}).some(action => action !== 'allow')) ? [UNRESOLVED_TRIPLE_RISK] : []
    const planWarnings = [...new Set([...goalWarnings, ...retained.flatMap(card => card.warnings), ...(mergeRisk?.warnings ?? []), ...tripleWarnings])]
    for (const warning of planWarnings) warnings.add(warning)
    if (!targetCount || (invoking && goal.kind === 'combo' && (threshold === null || targetCount < threshold))) return

    plans.push({
      cardIds: [...(triple ?? pair ?? []), ...active].map(card => card.id),
      targetCount,
      threshold,
      activated: threshold !== null && targetCount >= threshold,
      ...(goal.kind === 'combo' && retainedCount > 0 && threshold !== null
        ? { duplicateCurrency: [{ label: goal.label, count: targetCount, threshold }] } : {}),
      merges: pair && mergeRisk?.outputTier ? [{ firstId: pair[0].id, consumedId: pair[1].id, outputTier: mergeRisk.outputTier }] : [],
      ...(triple ? { triples: [{ firstId: triple[0].id, consumedId: triple[1].id, thirdId: triple[2].id }] } : {}),
      warnings: planWarnings,
    })
  }

  visitInvocationOrders(cards, required, addPlan, warning => warnings.add(warning), limit)
  return { plans: plans.sort(comparePlans).slice(0, 3), warnings: [...warnings] }
}

function filterCards(cards: FateCard[], filters: PlanningFilters) {
  const excluded: { cardId: string; reasons: string[] }[] = []
  const warnings: string[] = []
  const eligible = cards.filter(card => {
    const assessment = assessPlanningCard(card, filters)
    if (assessment.excluded) excluded.push({ cardId: card.id, reasons: assessment.reasons })
    else warnings.push(...assessment.warnings)
    return !assessment.excluded
  })
  return { eligible, excluded, warnings: [...new Set(warnings)] }
}

export function planInvocation(cards: FateCard[], goal: AdvisorGoal, filters: PlanningFilters = {}, limit: InvocationLimit = MAX_INVOCATION_INPUTS): PlanResult {
  const problem = advisorInputProblem(cards, MAX_COLLECTED_FATES, 'collected')
  if (problem || !validGoal(goal)) return { status: 'insufficient', plans: [], warnings: [problem ?? 'Choose a reward goal.'] }

  const filtered = filterCards(cards, filters)
  const analysis = analyzeGoal(filtered.eligible, goal)
  analysis.warnings.push(...filtered.warnings)
  const { plans, warnings } = searchPlans(analysis.cards, goal, analysis.threshold, analysis.warnings, undefined, filters, true, limit)
  const collectingPlans = !plans.length ? searchPlans(analysis.cards, goal, analysis.threshold, analysis.warnings, undefined, filters, false, limit).plans : []
  const status = !plans.length ? 'insufficient' : warnings.length ? 'provisional' : 'ready'
  return { status, plans, collectingPlans, excluded: filtered.excluded, warnings: [...warnings, ...(!plans.length ? [collectingPlans.length ? 'No active reward for this goal. Incomplete combo progress is only useful while collecting.' : NO_PROGRESS] : []), COMBAT_WARNING] }
}

export function recommendFates(offered: FateCard[], collected: FateCard[], goal: AdvisorGoal, filters: PlanningFilters = {}, lastOffer = false, limit: InvocationLimit = MAX_INVOCATION_INPUTS): Recommendation {
  const problem = advisorInputProblem(offered, MAX_OFFERED_FATES, 'offered') ?? advisorInputProblem(collected, MAX_COLLECTED_FATES, 'collected')
  if (problem || !validGoal(goal)) {
    return { status: 'insufficient', comparison: 'unknown', baseline: null, candidates: [], recommendedCardIds: [], warnings: [problem ?? 'Choose a reward goal.'] }
  }

  const collectedIds = new Set(collected.map(card => card.id))
  const filteredCollected = filterCards(collected, filters)
  const filteredOffered = filterCards(offered, filters)
  collected = filteredCollected.eligible
  const eligible = filteredOffered.eligible.filter(card => !collectedIds.has(card.id))
  const analysis = analyzeGoal([...collected, ...eligible], goal)
  analysis.warnings.push(...filteredCollected.warnings, ...filteredOffered.warnings)
  const pool = analysis.cards.slice(0, collected.length)
  const baseline = searchPlans(pool, goal, analysis.threshold, analysis.warnings, undefined, filters, lastOffer, limit)
  const baselineScore = baseline.plans[0] ? score(baseline.plans[0]) : 0
  const warnings = new Set(baseline.warnings)
  const candidates = analysis.cards.slice(collected.length).map(card => {
    const result = searchPlans(pool, goal, analysis.threshold, analysis.warnings, card, filters, lastOffer, limit)
    for (const warning of result.warnings) warnings.add(warning)
    const plan = result.plans[0] ?? null
    return { cardId: card.id, plan, gain: plan ? score(plan) - baselineScore : null, warnings: result.warnings }
  })
  candidates.sort((a, b) => a.plan && b.plan ? comparePlans(a.plan, b.plan) : Number(!!b.plan) - Number(!!a.plan))
  const best = candidates[0]?.plan
  const recommendedCardIds = best && score(best) > baselineScore
    ? candidates.filter(({ plan }) => plan && (lastOffer ? score(plan) === score(best) : comparePlans(plan, best) === 0)).map(({ cardId }) => cardId)
    : []
  const status = !recommendedCardIds.length ? 'insufficient' : warnings.size ? 'provisional' : 'ready'
  const comparison = recommendedCardIds.length ? 'improvement' : warnings.size ? 'unknown' : 'no-improvement'
  if (offered.some(card => collectedIds.has(card.id))) warnings.add('Offered Fates already in the collected pool were excluded.')
  if (!best) warnings.add(NO_PROGRESS)
  else if (!recommendedCardIds.length) warnings.add('No offered Fate shows an improvement over the collected pool.')
  warnings.add(COMBAT_WARNING)
  return { status, comparison, baseline: baseline.plans[0] ?? null, candidates, recommendedCardIds, warnings: [...warnings], excluded: [...filteredCollected.excluded, ...filteredOffered.excluded] }
}
