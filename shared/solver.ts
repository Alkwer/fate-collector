import { z } from './validation.ts'
import {
  advisorInputProblem, MAX_COLLECTED_FATES, MAX_OFFERED_FATES, MERGED_REGULAR_MULTIPLIER,
  normalizeRewardLabel, TRIPLED_REGULAR_MULTIPLIER, UNKNOWN_FATE_NAME, UNRESOLVED_COMBO_MERGE,
  UNRESOLVED_COMBO_TRIPLE, UNRESOLVED_TRIPLE_RISK, visitInvocationOrders,
  type AdvisorGoal, type InvocationPlan, type PlanResult, type Recommendation,
} from './advisor'
import { KNOWN_COMBOS } from './reward-catalog'
import { isRewardIdentified, needsUniqueTooltipCheck } from './reward-evidence'
import { cardSchema, rewardSchema, type FateCard } from './schema'
import { riskSettingsSchema } from './fate-risk'
import { assessPlanningCard, assessPlanningMerge } from './planning-filters'

function rewardKey(kind: SolverReward['kind'], label: string): string {
  return `${kind}:${normalizeRewardLabel(label)}`
}

export const solverProfileSchema = z.object({
  goals: z.array(z.object({
    kind: z.enum(['regular', 'combo']),
    label: z.string().trim().min(1).max(160),
    weight: z.number().finite().min(0).max(1_000_000),
  }).strict()).max(30),
  avoidModifiers: z.array(z.string().trim().min(1).max(1000)).max(30),
  risks: riskSettingsSchema.optional(),
  objective: z.enum(['rewards', 'viscera']).optional(),
}).strict().superRefine(({ goals }, ctx) => {
  const keys = new Set<string>()
  for (const [index, goal] of goals.entries()) {
    const key = rewardKey(goal.kind, goal.label)
    if (keys.has(key)) ctx.addIssue({ code: 'custom', path: ['goals', index, 'label'], message: 'Use each reward goal only once.' })
    keys.add(key)
  }
})

export type SolverProfile = z.infer<typeof solverProfileSchema>

export function unweightedRewards(cards: FateCard[], profile: SolverProfile): AdvisorGoal[] {
  const weighted = new Set(profile.goals.filter(goal => goal.weight > 0).map(goal => rewardKey(goal.kind, goal.label)))
  const missing = new Map<string, AdvisorGoal>()
  for (const card of cards) for (const reward of card.rewards) {
    if (!isRewardIdentified(reward) || reward.kind === 'unknown' || !reward.label.trim()) continue
    const key = rewardKey(reward.kind, reward.label)
    if (!weighted.has(key)) missing.set(key, { kind: reward.kind, label: reward.label.trim() })
  }
  return [...missing.values()]
}

export type SolverReward = {
  kind: AdvisorGoal['kind'] | 'unknown'
  label: string
  count: number | null
  threshold: number | null
  activated: boolean
  weight: number
  points: number
  uncertain: boolean
}

export type SolverPlan = {
  cardIds: string[]
  score: number
  progress: number
  rewards: SolverReward[]
  merges: InvocationPlan['merges']
  triples?: InvocationPlan['triples']
  retained: { cardId: string; multiplier: number }[]
  discardedCardIds: string[]
  warnings: string[]
}

type SolverResult = {
  status: PlanResult['status']
  warnings: string[]
  excluded: { cardId: string; reasons: string[] }[]
}

export type SolverInvocation = SolverResult & { plans: SolverPlan[]; tiedBestPlanCount: number; collectingPlans?: SolverPlan[]; rewardBaseline?: SolverPlan | null }

export type SolverCandidate = {
  cardId: string
  plan: SolverPlan | null
  gain: number | null
  progressGain: number | null
  warnings: string[]
}

export type SolverPortfolio = SolverResult & {
  baseline: SolverPlan | null
  recommendedCardIds: string[]
  comparison: Recommendation['comparison']
  candidates: SolverCandidate[]
}

type Warning = { message: string; affectsRanking: boolean }
type ObservedReward = Pick<SolverReward, 'kind' | 'label' | 'count' | 'threshold'> & { key: string }
type PreparedCard = {
  original: FateCard
  id: string
  name: string
  tier: number | null
  tierReviewed: boolean
  rewards: ObservedReward[]
  warnings: Warning[]
  modifiersUnrecorded: boolean
}

const MAX_DISPLAYED_PLANS = 3
const CHECK_MODIFIERS = 'A Fate has no recorded modifiers. Its modifier safety is unverified.'

function solverInputProblem(cards: FateCard[], limit: number, group: string): string | null {
  const problem = advisorInputProblem(cards, limit, group)
  if (problem) return problem
  for (const card of cards) {
    if (!cardSchema.shape.name.safeParse(card.name).success || card.rewards.length > 30
      || card.rewards.some(reward => !rewardSchema.shape.label.safeParse(reward.label).success)
      || !cardSchema.shape.modifiers.safeParse(card.modifiers).success
      || !cardSchema.shape.visualReview.safeParse(card.visualReview).success) {
      return `Check the reward lists, modifiers and visual review of the ${group} Fates.`
    }
  }
  return null
}

function unknownRow(key: string, label: string): ObservedReward {
  return { key, kind: 'unknown', label, count: null, threshold: null }
}

function prepareCards(cards: FateCard[], profile: SolverProfile, excludedIds: Set<string>, excluded: SolverResult['excluded']): PreparedCard[] {
  const filters = profile.avoidModifiers
  const priorityKinds = new Set(profile.goals.filter(goal => goal.weight > 0).map(goal => goal.kind))
  const eligible: PreparedCard[] = []
  for (const card of cards) {
    const modifiers = card.modifiers.map(modifier => modifier.normalize().toLowerCase()).filter(modifier => modifier.trim())
    const assessment = assessPlanningCard(card, { ...profile, excludedCardIds: [...excludedIds] })
    const reasons = assessment.reasons
    if (reasons.length) {
      excluded.push({ cardId: card.id, reasons: [...new Set(reasons)] })
      continue
    }

    const warnings: Warning[] = assessment.warnings.map(message => ({ message, affectsRanking: true }))
    const name = normalizeRewardLabel(card.name)
    if (!name) warnings.push({ message: UNKNOWN_FATE_NAME, affectsRanking: true })
    const rewards: ObservedReward[] = card.rewards.map(reward => {
      const kind = isRewardIdentified(reward) && normalizeRewardLabel(reward.label) ? reward.kind : 'unknown'
      const label = reward.label.trim() || 'Unidentified reward'
      if (kind === 'unknown') {
        warnings.push({
          message: 'An unidentified reward or reward kind leaves the reward outcome incomplete.',
          affectsRanking: needsUniqueTooltipCheck(reward) || reward.kind === 'unknown' || priorityKinds.has(reward.kind),
        })
      }
      return { key: rewardKey(kind, label), kind, label, count: reward.count, threshold: kind === 'combo' ? reward.threshold : null }
    })
    if (!rewards.length) {
      warnings.push({ message: 'At least one Fate has no recorded rewards.', affectsRanking: true })
      rewards.push(unknownRow('missing', 'Unrecorded rewards'))
    } else if (card.visualReview && !card.visualReview.rewardsReviewed) {
      warnings.push({ message: 'Check the full reward row before relying on this ranking.', affectsRanking: true })
      rewards.push(unknownRow('unreviewed', 'Reward row not reviewed'))
    }
    eligible.push({ original: card, id: card.id, name, tier: card.tier, tierReviewed: card.visualReview?.tierReviewed ?? true, rewards, warnings,
      modifiersUnrecorded: filters.length > 0 && modifiers.length === 0 })
  }
  return eligible
}

type ComboThreshold = { threshold: number | null; warning?: Warning }

function comboThresholds(cards: PreparedCard[], weights: Map<string, number>): Map<string, ComboThreshold> {
  const catalog = new Map(KNOWN_COMBOS.map(combo => [rewardKey('combo', combo.label), combo.threshold]))
  const observed = new Map<string, { label: string; values: Set<number> }>()
  for (const card of cards) {
    for (const reward of card.rewards) {
      if (reward.kind !== 'combo') continue
      const entry = observed.get(reward.key) ?? { label: reward.label, values: new Set<number>() }
      const known = catalog.get(reward.key)
      if (known !== undefined) entry.values.add(known)
      if (reward.threshold !== null) entry.values.add(reward.threshold)
      observed.set(reward.key, entry)
    }
  }
  return new Map([...observed].map(([key, { label, values }]) => [key, values.size === 1
    ? { threshold: [...values][0] }
    : { threshold: null, warning: {
      message: values.size ? `Conflicting thresholds leave “${label}” activation unresolved.` : `The threshold for “${label}” is unknown.`,
      affectsRanking: (weights.get(key) ?? 0) > 0,
    } }]))
}

function recordWarning(warnings: Map<string, boolean>, { message, affectsRanking }: Warning): void {
  warnings.set(message, affectsRanking || (warnings.get(message) ?? false))
}

function cardWarnings(card: PreparedCard): Warning[] {
  return card.modifiersUnrecorded ? [...card.warnings, { message: CHECK_MODIFIERS, affectsRanking: true }] : card.warnings
}

// Ignore the last floating-point digits so equivalent fractional priorities tie.
function roundPoints(points: number): number {
  return Number(points.toPrecision(15))
}

function comparePlans(a: SolverPlan, b: SolverPlan): number {
  return b.score - a.score || b.progress - a.progress || a.cardIds.length - b.cardIds.length
}

function searchPlans(pool: PreparedCard[], weights: Map<string, number>, thresholds: Map<string, ComboThreshold>, required?: PreparedCard, profile?: SolverProfile) {
  const plans: SolverPlan[] = []
  const warnings = new Map<string, boolean>()
  for (const card of required ? [...pool, required] : pool) {
    for (const warning of cardWarnings(card)) recordWarning(warnings, warning)
  }

  function addPlan(active: PreparedCard[], pair?: [PreparedCard, PreparedCard], triple?: [PreparedCard, PreparedCard, PreparedCard]) {
    const mergeRisk = pair ? assessPlanningMerge(pair[0].original, profile ?? {}) : null
    if (mergeRisk?.excluded) {
      for (const reason of mergeRisk.reasons) recordWarning(warnings, { message: `Merged plan excluded: ${reason}`, affectsRanking: false })
      return
    }
    const retained = active.map(card => ({ card, multiplier: 1 }))
    if (pair) retained.unshift({ card: pair[0], multiplier: MERGED_REGULAR_MULTIPLIER })
    if (triple) retained.push(
      { card: triple[0], multiplier: TRIPLED_REGULAR_MULTIPLIER },
      { card: triple[2], multiplier: TRIPLED_REGULAR_MULTIPLIER },
    )
    const selected = [...(triple ?? pair ?? []), ...active]
    const discarded = triple?.[1] ?? pair?.[1]
    const planWarnings = new Map<string, boolean>()
    if (triple && (profile?.avoidModifiers.length || Object.values(profile?.risks ?? {}).some(action => action !== 'allow'))) recordWarning(planWarnings, { message: UNRESOLVED_TRIPLE_RISK, affectsRanking: true })
    for (const message of mergeRisk?.warnings ?? []) recordWarning(planWarnings, { message, affectsRanking: true })
    const totals = new Map<string, ObservedReward>()
    if (discarded?.modifiersUnrecorded) recordWarning(planWarnings, { message: CHECK_MODIFIERS, affectsRanking: true })

    for (const { card, multiplier } of retained) {
      for (const warning of cardWarnings(card)) recordWarning(planWarnings, warning)
      for (const reward of card.rewards) {
        const existing = totals.get(reward.key)
        const unresolvedCount = multiplier > 1 && reward.kind !== 'regular'
        if (unresolvedCount && reward.kind === 'combo') {
          recordWarning(planWarnings, {
            message: triple ? UNRESOLVED_COMBO_TRIPLE : UNRESOLVED_COMBO_MERGE,
            affectsRanking: (weights.get(reward.key) ?? 0) > 0,
          })
        }
        const count = unresolvedCount || reward.count === null || existing?.count === null
          ? null : (existing?.count ?? 0) + reward.count * multiplier
        totals.set(reward.key, { ...reward, label: existing?.label ?? reward.label, count })
      }
    }

    let score = 0
    let progress = 0
    const rewards: SolverReward[] = []
    for (const [key, { kind, label, count }] of totals) {
      const combo = thresholds.get(key)
      if (combo?.warning) recordWarning(planWarnings, combo.warning)
      const threshold = combo?.threshold ?? null
      const weight = weights.get(key) ?? 0
      const activated = count !== null && threshold !== null && count >= threshold
      const points = roundPoints(kind === 'regular' ? (count ?? 0) * weight : activated ? weight : 0)
      if (count !== null && threshold !== null) progress += weight * Math.min(count / threshold, 1)
      score += points
      rewards.push({ kind, label, count, threshold, activated, weight, points,
        uncertain: kind === 'unknown' || (kind === 'combo' && (count === null || threshold === null)) })
    }
    for (const [message, affectsRanking] of planWarnings) recordWarning(warnings, { message, affectsRanking })
    plans.push({
      cardIds: selected.map(card => card.id), score: roundPoints(score), progress: roundPoints(progress), rewards,
      merges: pair ? [{ firstId: pair[0].id, consumedId: pair[1].id, outputTier: 3 }] : [],
      ...(triple ? { triples: [{ firstId: triple[0].id, consumedId: triple[1].id, thirdId: triple[2].id }] } : {}),
      retained: retained.map(({ card, multiplier }) => ({ cardId: card.id, multiplier })),
      discardedCardIds: discarded ? [discarded.id] : [],
      warnings: [...planWarnings.keys()],
    })
  }

  visitInvocationOrders(pool, required, addPlan, message => recordWarning(warnings, { message, affectsRanking: true }))
  return { plans: plans.sort(comparePlans), warnings }
}

function initialize(profile: SolverProfile, excludedCardIds: string[], problem: string | null) {
  if (problem) return { problem }
  const parsed = solverProfileSchema.safeParse(profile)
  if (!parsed.success) return { problem: 'Check the reward priorities and modifier filters.' }
  if (parsed.data.objective !== 'viscera' && !parsed.data.goals.some(goal => goal.weight > 0)) return { problem: 'Choose at least one positive reward priority.' }
  if (!Array.isArray(excludedCardIds) || [...excludedCardIds].some(id => typeof id !== 'string' || !id.trim())) {
    return { problem: 'Use valid Fate IDs for exclusions.' }
  }
  return { profile: parsed.data, excludedIds: new Set(excludedCardIds),
    weights: new Map(parsed.data.goals.map(goal => [rewardKey(goal.kind, goal.label), goal.weight])) }
}

export function visceraFactors(plan: SolverPlan) {
  return { inputs: plan.cardIds.length, duplicate: plan.merges.length > 0 || !!plan.triples?.length }
}

// GGG gives two monotonic factors, not their relative strength or probabilities.
// A duplicate pair and three distinct Fates remain incomparable.
function dominatesViscera(a: SolverPlan, b: SolverPlan) {
  const x = visceraFactors(a), y = visceraFactors(b)
  return x.inputs >= y.inputs && Number(x.duplicate) >= Number(y.duplicate)
    && (x.inputs > y.inputs || Number(x.duplicate) > Number(y.duplicate))
}

function sameVisceraFactors(a: SolverPlan, b: SolverPlan) {
  const x = visceraFactors(a), y = visceraFactors(b)
  return x.inputs === y.inputs && x.duplicate === y.duplicate
}

function visceraFrontier(plans: SolverPlan[]) {
  return plans.filter(plan => !plans.some(other => dominatesViscera(other, plan)
    || (sameVisceraFactors(other, plan) && other.score > plan.score)))
}

const VISCERA_WARNING = 'Viscera farming compares Fate count and duplicate presence. Drop chances and the trade-off between these factors are unknown. Check that this boss has the Viscera you want.'

function displayVisceraPlans(plans: SolverPlan[]) {
  // Show distinct factor combinations before alternative reward orders.
  const representatives = plans.filter((plan, i) => !plans.slice(0, i).some(other => sameVisceraFactors(other, plan)))
  return [...representatives, ...plans.filter(plan => !representatives.includes(plan))].slice(0, MAX_DISPLAYED_PLANS)
}

export function solveInvocation(cards: FateCard[], profile: SolverProfile, excludedCardIds: string[] = []): SolverInvocation {
  const input = initialize(profile, excludedCardIds, solverInputProblem(cards, MAX_COLLECTED_FATES, 'collected'))
  if (input.problem !== undefined) {
    return { status: 'insufficient', warnings: [input.problem], excluded: [], plans: [], tiedBestPlanCount: 0 }
  }
  const excluded: SolverResult['excluded'] = []
  const pool = prepareCards(cards, input.profile, input.excludedIds, excluded)
  const { plans, warnings } = searchPlans(pool, input.weights, comboThresholds(pool, input.weights), undefined, input.profile)
  // Keep neutral inputs in the search: they can enable a useful duplicate merge.
  // Only the final, positive-outcome plans are recommendations to consume cards.
  const farming = input.profile.objective === 'viscera'
  const rewardPlans = plans.filter(plan => plan.score > 0).sort((a, b) => b.score - a.score || a.cardIds.length - b.cardIds.length)
  const useful = farming ? visceraFrontier(plans) : rewardPlans
  if (farming) warnings.set(VISCERA_WARNING, true)
  const best = useful[0]
  const status = !best ? 'insufficient' : [...warnings.values()].some(Boolean) ? 'provisional' : 'ready'
  const collectingPlans = !best && !farming ? plans.filter(plan => plan.progress > 0).slice(0, MAX_DISPLAYED_PLANS) : []
  if (!best) warnings.set(pool.length ? 'No active reward for these priorities. Incomplete combo progress is only useful while collecting.' : 'Collect an eligible Fate to plan an invocation.', false)
  return { status, warnings: [...warnings.keys()], excluded, plans: farming ? displayVisceraPlans(useful) : useful.slice(0, MAX_DISPLAYED_PLANS), collectingPlans,
    ...(farming ? { rewardBaseline: rewardPlans[0] ?? null } : {}),
    tiedBestPlanCount: best ? useful.filter(plan => farming || (plan.score === best.score && plan.cardIds.length === best.cardIds.length)).length : 0 }
}

export function recommendPortfolio(offered: FateCard[], collected: FateCard[], profile: SolverProfile, excludedCardIds: string[] = []): SolverPortfolio {
  const input = initialize(profile, excludedCardIds, solverInputProblem(offered, MAX_OFFERED_FATES, 'offered')
    ?? solverInputProblem(collected, MAX_COLLECTED_FATES, 'collected'))
  if (input.problem !== undefined) {
    return { status: 'insufficient', warnings: [input.problem], excluded: [], baseline: null,
      candidates: [], recommendedCardIds: [], comparison: 'unknown' }
  }
  const excluded: SolverResult['excluded'] = []
  const collectedIds = new Set(collected.map(card => card.id))
  const newOffers = offered.filter(card => !collectedIds.has(card.id))
  const pool = prepareCards(collected, input.profile, input.excludedIds, excluded)
  const eligible = prepareCards(newOffers, input.profile, input.excludedIds, excluded)
  const thresholds = comboThresholds([...pool, ...eligible], input.weights)
  const initial = searchPlans(pool, input.weights, thresholds, undefined, input.profile)
  const baseline = initial.plans[0] ?? null
  const warnings = initial.warnings
  const candidates: SolverCandidate[] = eligible.map(card => {
    const result = searchPlans(pool, input.weights, thresholds, card, input.profile)
    for (const [message, affectsRanking] of result.warnings) recordWarning(warnings, { message, affectsRanking })
    const plan = result.plans[0] ?? null
    return { cardId: card.id, plan,
      gain: plan ? roundPoints(plan.score - (baseline?.score ?? 0)) : null,
      progressGain: plan ? roundPoints(plan.progress - (baseline?.progress ?? 0)) : null,
      warnings: [...result.warnings.keys()] }
  })
  if (input.profile.objective === 'viscera') {
    const baselinePlans = visceraFrontier(initial.plans)
    const byCandidate = eligible.map(card => {
      const result = searchPlans(pool, input.weights, thresholds, card, input.profile)
      return { cardId: card.id, plans: visceraFrontier(result.plans) }
    })
    const frontier = visceraFrontier([...initial.plans, ...byCandidate.flatMap(candidate => candidate.plans)])
    const recommendedCardIds = byCandidate.filter(candidate => candidate.plans.some(plan => frontier.includes(plan)
      && !baselinePlans.some(base => sameVisceraFactors(base, plan) && base.score >= plan.score))).map(candidate => candidate.cardId)
    warnings.set(VISCERA_WARNING, true)
    const farmBaseline = baselinePlans[0] ?? null
    return { status: frontier.length ? 'provisional' : 'insufficient', comparison: recommendedCardIds.length ? 'improvement' : 'unknown',
      warnings: [...warnings.keys()], excluded, baseline: farmBaseline, recommendedCardIds,
      candidates: candidates.map(candidate => {
        const choices = byCandidate.find(row => row.cardId === candidate.cardId)?.plans ?? []
        const plan = choices.find(item => frontier.includes(item)) ?? choices[0] ?? null
        return { ...candidate, plan, gain: plan ? roundPoints(plan.score - (farmBaseline?.score ?? 0)) : null,
          progressGain: plan ? roundPoints(plan.progress - (farmBaseline?.progress ?? 0)) : null }
      }) }
  }
  candidates.sort((a, b) => a.plan && b.plan ? comparePlans(a.plan, b.plan) : Number(!!b.plan) - Number(!!a.plan))
  const best = candidates[0]
  const bestPlan = best?.plan
  const measuredImprovement = (best?.gain ?? 0) > 0 || (best?.gain === 0 && (best.progressGain ?? 0) > 0)
  const recommendedCardIds = bestPlan && measuredImprovement
    ? candidates.filter(({ plan }) => plan && comparePlans(plan, bestPlan) === 0).map(({ cardId }) => cardId)
    : []
  const provisional = [...warnings.values()].some(Boolean)
  const status = !bestPlan ? 'insufficient' : provisional ? 'provisional' : 'ready'
  const comparison = status !== 'ready' ? 'unknown' : measuredImprovement ? 'improvement' : 'no-improvement'
  if (newOffers.length < offered.length) warnings.set('Offered Fates already in the collected pool were ignored.', false)
  if (!bestPlan) warnings.set('An eligible offered Fate is needed for comparison.', false)
  return { status, warnings: [...warnings.keys()], excluded, baseline, candidates, recommendedCardIds, comparison }
}
