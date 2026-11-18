import { describe, expect, it } from 'vitest'
import { tooltipAdvice } from '../src/lib/tooltip-advice'
import { recommendFates } from '../shared/advisor'
import { newCard, newReward } from '../shared/offers'
import type { FateCard, Reward } from '../shared/schema'
import { recommendPortfolio, type SolverProfile } from '../shared/solver'

const offeredCard = (name: string, ...rewards: Reward[]): FateCard => ({ ...newCard(), name, tier: 2, rewards })
const regular = (label: string, count = 1): Reward => ({ ...newReward(), kind: 'regular', label, count, identified: true })
const feathers = (): Reward => ({ ...newReward(), visualId: 'orange-feathers' })
const orderedFate = (threshold = 2): Reward => ({ ...feathers(), label: 'Ordered Fate', kind: 'combo', threshold, identified: true, tooltipConfirmed: true })
const profile: SolverProfile = {
  goals: [{ kind: 'regular', label: 'Gold', weight: 1 }, { kind: 'combo', label: 'Ordered Fate', weight: 4 }],
  avoidModifiers: [],
}
const profitGoal = { kind: 'profit', objective: 'ordered-fate' } as const

function weighted(offered: FateCard[], collected: FateCard[] = [], excludedCardIds: string[] = [], lastOffer = false) {
  return tooltipAdvice({ offered, collected, excludedCardIds, profile, lastOffer,
    ranking: { mode: 'portfolio', result: recommendPortfolio(offered, collected, profile, excludedCardIds, lastOffer) },
  })
}

describe('overlay tooltip advice', () => {
  it('points to a unique motif on an incompletely reviewed row for a named challenge target', () => {
    const offered = [offeredCard('Rot', regular('Gold')), offeredCard('Dryad', regular('Gold'), {
      ...feathers(), label: "Dreadmaidens' Sacrament", kind: 'combo', threshold: 2, identified: true,
    })]
    expect(tooltipAdvice({ offered, collected: [], profile, excludedCardIds: [], ranking: null, leagueGoal: profitGoal }))
      .toBe("Hover #2's orange feathers icon for Ordered Fate (Promised Profits).")
    expect(offered[1].rewards[1]).toMatchObject({ label: "Dreadmaidens' Sacrament", identified: true })
  })

  it('uses the position on a checked complete reward row and describes a conditional combo', () => {
    const card = offeredCard('Crowkeeper', { ...regular('Gold'), visualId: 'gold-stack' }, feathers())
    card.visualReview = { version: 'visual-test', tierReviewed: true, rewardsReviewed: true }
    const input = { offered: [card], collected: [offeredCard('Dryad', orderedFate())], profile,
      excludedCardIds: [], ranking: null, leagueGoal: profitGoal }
    expect(tooltipAdvice(input)).toBe('Hover #1, icon 2 from the left for Ordered Fate. A match could complete the Promised Profits combo.')
    input.collected[0].rewards = [orderedFate(3)]
    expect(tooltipAdvice(input)).toBe('Hover #1, icon 2 from the left for Ordered Fate (Promised Profits).')
  })

  it('uses a PoEDB-backed possible identity for a named challenge with an unverified threshold', () => {
    const offered = [offeredCard('Rot', feathers())]
    expect(tooltipAdvice({ offered, collected: [], profile, excludedCardIds: [], ranking: null,
      leagueGoal: { kind: 'profit', objective: 'vendigo' },
    })).toBe("Hover #1's orange feathers icon for Hide of the Vendigo (Promised Profits).")
  })

  it('does not project an Ordered Fate combo across aliases for the same Fate', () => {
    const card = offeredCard('Rot', feathers())
    card.visualReview = { version: 'visual-test', rewardsReviewed: false, tierReviewed: false }
    const offered = [card]
    const collected = [offeredCard('Rotted', orderedFate())]
    expect(tooltipAdvice({ offered, collected, profile, excludedCardIds: [], ranking: null, leagueGoal: profitGoal }))
      .toBe("Hover #1's orange feathers icon for Ordered Fate (Promised Profits).")
    expect(weighted(offered, collected)).toBeNull()
  })

  it('only suggests a currently useful portfolio check if the matching tooltip would put a choice ahead', () => {
    const offered = [offeredCard('Rot', regular('Gold')), offeredCard('Dryad', feathers())]
    const collected = [offeredCard('Crowkeeper', orderedFate())]
    expect(weighted(offered)).toBeNull()
    expect(weighted(offered, collected)).toBe("Hover #2's orange feathers icon for Ordered Fate. That combo could put this card ahead.")
    expect(weighted(offered, collected, [], true)).toContain("Hover #2's orange feathers icon")
    offered[0].rewards[0].count = 4
    expect(weighted(offered, collected)).toBeNull()
  })

  it('can resolve a current tie but skips a card already clearly ahead', () => {
    const offered = [offeredCard('Rot', regular('Gold')), offeredCard('Dryad', feathers(), regular('Gold'))]
    const collected = [offeredCard('Crowkeeper', orderedFate())]
    expect(weighted(offered, collected)).toContain('That combo could put this card ahead.')
    offered[1].rewards[1].count = 2
    expect(weighted(offered, collected)).toBeNull()
  })

  it('uses a single goal and distinguishes unfinished progress from a payable result on the last offer', () => {
    const offered = [offeredCard('Dryad', feathers())]
    const goal = { kind: 'combo', label: 'Ordered Fate' } as const
    const check = (collected: FateCard[], lastOffer: boolean) => tooltipAdvice({ offered, collected, profile,
      excludedCardIds: [], lastOffer,
      ranking: { mode: 'single', goal, result: recommendFates(offered, collected, goal, {}, lastOffer) },
    })
    expect(check([], false)).toContain('A match could put this card ahead on combo progress.')
    expect(check([], true)).toBeNull()
    expect(check([offeredCard('Crowkeeper', orderedFate())], true)).toContain('That combo could put this card ahead.')
  })

  it('honors exclusions and skips an indistinguishable motif, including in a challenge', () => {
    const offered = [offeredCard('Rot', feathers(), feathers()), offeredCard('Dryad', feathers())]
    const collected = [offeredCard('Crowkeeper', orderedFate())]
    expect(weighted(offered, collected, [offered[1].id])).toBeNull()
    expect(tooltipAdvice({ offered, collected, profile, ranking: null, leagueGoal: profitGoal,
      excludedCardIds: [offered[1].id] })).toBeNull()
    offered[1].modifiers = ['Inflicts Bleeding on Hit']
    expect(tooltipAdvice({ offered, collected, profile: { ...profile, avoidModifiers: ['bleeding'] },
      ranking: null, leagueGoal: profitGoal, excludedCardIds: [] })).toBeNull()
  })

  it('does not use unidentified motifs for Viscera ranking or unrelated challenges', () => {
    const offered = [offeredCard('Rot', feathers())]
    const collected = [offeredCard('Crowkeeper', orderedFate())]
    const farming: SolverProfile = { ...profile, objective: 'viscera' }
    const ranking = { mode: 'portfolio', result: recommendPortfolio(offered, collected, farming) } as const
    expect(tooltipAdvice({ offered, collected, profile: farming, excludedCardIds: [], ranking })).toBeNull()
    expect(tooltipAdvice({ offered, collected, profile: farming, excludedCardIds: [], ranking,
      leagueGoal: { kind: 'profit', objective: 'gem' } })).toBeNull()
    expect(tooltipAdvice({ offered, collected, profile: farming, excludedCardIds: [], ranking,
      leagueGoal: profitGoal })).toContain('Promised Profits combo.')
  })
})
