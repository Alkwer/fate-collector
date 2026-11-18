import { normalizeRewardLabel, visitInvocationOrders } from '../../shared/advisor'
import { assessPlanningCard, assessPlanningMerge } from '../../shared/planning-filters'
import { recommendPortfolio, solveInvocation, unweightedRewards, type SolverPlan, type SolverProfile } from '../../shared/solver'
import type { FateCard } from '../../shared/schema'
import type { OmenMap } from './fight-journal'
import { profitRewardLabels, type LeagueGoal } from './league-challenges'

interface Options {
  goal: NonNullable<LeagueGoal>
  offered: FateCard[]
  collected: FateCard[]
  mode: 'offer' | 'invoke'
  confirmedOmenMap: OmenMap | null
  profile: SolverProfile
  excludedCardIds: string[]
}

const nameList = (cards: FateCard[]) => cards.map(card => card.name.trim() || 'Unnamed Fate').join(' + ')

export function challengeAdvice({ goal, offered, collected, mode, confirmedOmenMap, profile, excludedCardIds }: Options): string {
  const choosing = mode === 'offer'
  if (goal.kind === 'omen') {
    if (confirmedOmenMap !== goal.map) return 'Check the map requirements for Overpowering Omens.'
    const filters = { ...profile, excludedCardIds }
    const eligible = (cards: FateCard[]) => cards.filter(card => !assessPlanningCard(card, filters).excluded)
    const ready = (cards: FateCard[], required?: FateCard) => {
      const asInput = (card: FateCard) => ({ name: normalizeRewardLabel(card.name), tier: card.tier, tierReviewed: !card.visualReview || card.visualReview.tierReviewed, original: card })
      const order = cards.filter(card => card.id !== required?.id).map(asInput)
      let inputs: FateCard[] = []
      visitInvocationOrders(order, required && asInput(required), (active, pair) => {
        if (pair && assessPlanningMerge(pair[0].original, filters).excluded) return
        const tierThree = pair || active.some(card => card.tier === 3 && card.tierReviewed)
        const plan = [...(pair ?? []), ...active].map(card => card.original)
        if (tierThree && (!inputs.length || plan.length < inputs.length)) inputs = plan
      }, () => undefined)
      return inputs
    }
    const available = eligible(collected)
    const plan = ready(available)
    if (plan.length) return `Tier 3 option for Overpowering Omens: ${nameList(plan)}. Check the final invocation in game.`
    const matches = choosing ? eligible(offered).filter(card => ready(available, card).length) : []
    return matches.length ? `Tier 3 choices for Overpowering Omens: ${nameList(matches)}.`
      : 'No supported Tier 3 option for Overpowering Omens yet.'
  }

  const labels = profitRewardLabels(goal.objective)
  const categoryProfile: SolverProfile = {
    ...profile,
    objective: 'rewards',
    goals: unweightedRewards([...offered, ...collected], { ...profile, goals: [] })
      .filter(reward => labels.has(normalizeRewardLabel(reward.label))).map(reward => ({ ...reward, weight: 1 })),
  }
  const matchesCategory = (plan: SolverPlan | null) => plan?.rewards.some(reward =>
    (reward.kind === 'regular' || reward.kind === 'combo' && reward.activated)
    && reward.count !== null && reward.count > 0 && !reward.uncertain && labels.has(normalizeRewardLabel(reward.label)))
  if (!categoryProfile.goals.length) return 'No active, supported reward for this Promised Profits objective yet.'
  const current = solveInvocation(collected, categoryProfile, excludedCardIds).plans.find(matchesCategory)
  if (current) {
    const inputs = current.cardIds.flatMap(id => collected.filter(card => card.id === id))
    return `Plan with a modeled Promised Profits match: ${nameList(inputs)}.`
  }
  if (choosing && offered.length) {
    const result = recommendPortfolio(offered, collected, categoryProfile, excludedCardIds)
    const matches = offered.filter(card => result.candidates.some(candidate => candidate.cardId === card.id && matchesCategory(candidate.plan)))
    if (matches.length) return `Choices with a modeled Promised Profits match: ${nameList(matches)}.`
  }
  return 'No active, supported reward for this Promised Profits objective yet.'
}
