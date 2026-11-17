import { expect, test } from 'vitest'
import { newCard, newReward } from '../shared/offers'
import { planInvocation } from '../shared/advisor'
import { solveInvocation, unweightedRewards } from '../shared/solver'
import { cardNeedsReview, cardReviewReasons } from '../src/lib/card-review'
import { catalogFields, REWARD_CATALOG } from '../shared/reward-catalog'
import { rewardSchema } from '../shared/schema'

test('legacy shared-icon assumptions cannot score even after the old visual review passed', () => {
  const card = { ...newCard(), name: 'Tempest', tier: 2, rewards: [{ ...newReward(),
    visualId: 'orange-feathers' as const, label: "Dreadmaidens' Sacrament", kind: 'combo' as const,
    identified: true, threshold: 2, count: 2,
  }], visualReview: { version: 'browser-v1/rewards-v3-screenshots-20261115', tierReviewed: true, rewardsReviewed: true } }
  const original = JSON.stringify(card)
  const goal = { label: "Dreadmaidens' Sacrament", kind: 'combo' as const }
  expect(cardNeedsReview(card)).toBe(true)
  expect(cardReviewReasons(card).join(' ')).toContain('exact tooltip')
  expect(planInvocation([card], goal).status).toBe('insufficient')
  expect(solveInvocation([card], { goals: [{ ...goal, weight: 5 }], avoidModifiers: [] }).plans).toEqual([])
  expect(JSON.stringify(card)).toBe(original)
  card.rewards[0] = { ...card.rewards[0], ...rewardSchema.parse({ ...card.rewards[0], tooltipConfirmed: true }) } as typeof card.rewards[0]
  expect(cardNeedsReview(card)).toBe(false)
  expect(planInvocation([card], goal).plans[0]).toMatchObject({ activated: true, targetCount: 2 })
})

test('different unique meanings do not form a shared-icon combo', () => {
  const cards = ['observed-ordered-fate', 'observed-doedres-tongue'].map((id, index) => ({ ...newCard(),
    name: index ? 'Wildfire' : 'Tempest', tier: 2,
    rewards: [{ ...newReward(), ...catalogFields(REWARD_CATALOG.find(row => row.id === id)!), visualId: 'orange-feathers' as const, tooltipConfirmed: true }],
  }))
  const plan = solveInvocation(cards, { goals: cards.map(card => ({ kind: 'combo', label: card.rewards[0].label, weight: 5 })), avoidModifiers: [] })
  expect(plan.plans).toEqual([])
  expect(plan.collectingPlans?.[0].score).toBe(0)
  expect(plan.collectingPlans?.[0].rewards.every(row => !row.activated)).toBe(true)
})

test('unweighted report distinguishes kinds and excludes unknown or unconfirmed rewards', () => {
  const cards = [{ ...newCard(), rewards: [
    { ...newReward(), label: 'Additional Currency Items', kind: 'regular' as const, identified: true },
    { ...newReward(), label: 'Additional Currency Items', kind: 'combo' as const, identified: true, threshold: 2 },
    { ...newReward(), label: ' Unknown ', identified: false },
    { ...newReward(), label: 'Old guess', kind: 'combo' as const, identified: true, visualId: 'orange-feathers' as const },
  ] }]
  expect(unweightedRewards(cards, { goals: [{ label: 'Additional Currency Items', kind: 'regular', weight: 3 }], avoidModifiers: [] }))
    .toEqual([{ label: 'Additional Currency Items', kind: 'combo' }])
})
