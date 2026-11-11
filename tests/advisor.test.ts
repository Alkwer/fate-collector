import { describe, expect, it } from 'vitest'
import { getAdvisorGoals, KNOWN_COMBOS, MAX_COLLECTED_FATES, MAX_OFFERED_FATES, normalizeRewardLabel, planInvocation, recommendFates } from '../shared/advisor'
import type { FateCard, Reward } from '../shared/schema'

const currency = { kind: 'regular', label: 'Currency' } as const
const gem = { kind: 'combo', label: 'Exceptional Gem' } as const

function reward(label: string = currency.label, count = 1, fields: Partial<Reward> = {}): Reward {
  return { id: label, label, count, kind: 'regular', threshold: null, identified: true, ...fields }
}

function combo(count = 1, threshold: number | null = null, label: string = gem.label): Reward {
  return reward(label, count, { kind: 'combo', threshold })
}

function fate(id: string, rewards: Reward[], fields: Partial<FateCard> = {}): FateCard {
  return { id, name: id, tier: 2, modifiers: [], rewards, ...fields }
}

describe('advisor goals', () => {
  it('normalizes case, spacing and apostrophes while keeping labels distinct', () => {
    expect(normalizeRewardLabel('  DREADMAIDENS’\t Sacrament ')).toBe("dreadmaidens' sacrament")
    const cards = [fate('Wildfire', [reward('  Currency '), reward('currency'), reward('Extra Currency'),
      combo(1, null, ' Dreadmaidensʼ Sacrament '), combo(1, 4, 'Other combo'),
      reward('Unread icon', 1, { identified: false }), reward('Unknown type', 1, { kind: 'unknown' })])]

    expect(getAdvisorGoals(cards)).toEqual([
      currency, { kind: 'regular', label: 'Extra Currency' },
      ...KNOWN_COMBOS.map(({ label }) => ({ kind: 'combo', label })), { kind: 'combo', label: 'Other combo' },
    ])
    expect(planInvocation([fate('a', [reward('Extra Currency')])], currency).status).toBe('insufficient')
  })
})

describe('offered Fate recommendations', () => {
  it('explains gains against the existing plan and distinguishes no benefit from missing evidence', () => {
    const owned = [fate('owned', [reward('Currency', 5)])]
    const result = recommendFates([fate('new', [reward('Currency', 2)])], owned, currency)
    expect(result).toMatchObject({ comparison: 'improvement', baseline: { targetCount: 5 }, candidates: [{ gain: 2, plan: { targetCount: 7 } }] })
    expect(recommendFates([fate('neutral', [reward('Armour')])], owned, currency)).toMatchObject({ comparison: 'no-improvement', candidates: [{ gain: 0 }] })
    expect(recommendFates([fate('unknown', [])], owned, currency).comparison).toBe('unknown')
    expect(recommendFates([fate('neutral', [reward('Armour')])], [], currency).comparison).toBe('no-improvement')
    expect(recommendFates([fate('invalid', [reward('Currency', 0)])], owned, currency)).toMatchObject({ comparison: 'unknown', baseline: null })
  })

  it('caps displayed combo gains at the threshold and never promises repeated payouts', () => {
    const result = recommendFates([fate('new', [combo(8)])], [fate('owned', [combo(2)])], gem)
    expect(result).toMatchObject({ comparison: 'improvement', baseline: { targetCount: 2 }, candidates: [{ gain: 1 }] })
    expect(recommendFates([fate('new', [combo(8)])], [fate('owned', [combo(3)])], gem)).toMatchObject({ comparison: 'no-improvement', candidates: [{ gain: 0 }] })
  })
  it('ranks by observed icons independently of Fate names and changes rank with the goal', () => {
    const offered = [
      fate('rot', [reward('Armour', 4)], { name: 'Rot' }),
      fate('first', [reward('  currency ', 2)], { name: 'Torchbearer' }),
      fate('second', [reward('Currency', 1), reward('Armour')], { name: 'Torchbearer' }),
    ]
    expect(recommendFates(offered, [], currency)).toMatchObject({
      status: 'ready', recommendedCardIds: ['first'],
      candidates: [{ cardId: 'first', plan: { targetCount: 2 } }, { cardId: 'second', plan: { targetCount: 1 } }, { cardId: 'rot', plan: null }],
    })
    expect(recommendFates(offered, [], { kind: 'regular', label: 'Armour' }).recommendedCardIds).toEqual(['rot'])
  })

  it('returns every tied card and excludes offers already in the collected pool', () => {
    const collected = fate('collected', [reward('Armour')])
    const offered = [fate('second', [reward()]), collected, fate('first', [reward()])]
    const result = recommendFates(offered, [collected], currency)

    expect(result).toMatchObject({ status: 'ready', recommendedCardIds: ['second', 'first'] })
    expect(result.candidates.map(({ cardId, plan }) => [cardId, plan?.cardIds])).toEqual([
      ['second', ['second']], ['first', ['first']],
    ])
    expect(result.warnings).toContainEqual(expect.stringMatching(/already in the collected pool/))
    expect(result.warnings).toContainEqual(expect.stringMatching(/Combat difficulty/))
  })

  it('uses at most two collected Fates in any offered card plan and leaves inputs unchanged', () => {
    const offered = [fate('duplicate', [reward('Armour')], { name: 'Torchbearer' }), fate('other', [reward('Currency', 2)])]
    const collected = [fate('torch', [reward('Currency', 3)], { name: 'Torchbearer' }),
      fate('next', [reward('Currency', 2)]), fate('last', [reward()])]
    const before = structuredClone({ offered, collected })
    const result = recommendFates(offered, collected, currency)

    expect(result).toMatchObject({
      status: 'ready', recommendedCardIds: ['duplicate'],
      candidates: [
        { cardId: 'duplicate', plan: { cardIds: ['torch', 'duplicate', 'next'], targetCount: 11 } },
        { cardId: 'other', plan: { cardIds: ['other', 'torch', 'next'], targetCount: 7 } },
      ],
    })
    expect({ offered, collected }).toEqual(before)
  })

  it('requires an improvement over the collected pool, including through a merge', () => {
    const collected = [fate('collected', [reward('Currency', 5)], { name: 'Rot' })]
    const neutral = fate('neutral', [reward('Armour')])
    expect(recommendFates([neutral], collected, currency)).toMatchObject({
      status: 'insufficient', recommendedCardIds: [], candidates: [{ plan: { targetCount: 5 } }],
      warnings: expect.arrayContaining([expect.stringMatching(/improvement over the collected pool/)]),
    })
    const duplicate = fate('duplicate', [reward('Armour')], { name: 'Rot' })
    expect(recommendFates([neutral, duplicate], collected, currency)).toMatchObject({
      status: 'ready', recommendedCardIds: ['duplicate'],
      candidates: [{ plan: { targetCount: 15, cardIds: ['collected', 'duplicate'] } }, { plan: { targetCount: 5 } }],
    })
  })

  it('keeps a measured lead provisional when rewards or card names are missing', () => {
    const offered = [
      fate('known', [reward()]), fate('unrecorded', []), fate('unknown-kind', [reward('Armour', 9, { kind: 'unknown' })]),
      fate('unidentified', [reward('Currency', 9, { identified: false })]), fate('missing-name', [reward('Armour')], { name: ' ' }),
    ]
    const result = recommendFates(offered, [], currency)

    expect(result).toMatchObject({ status: 'provisional', recommendedCardIds: ['known'] })
    expect(result.candidates.slice(1).every(candidate => candidate.plan === null)).toBe(true)
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringMatching(/no recorded rewards/), expect.stringMatching(/unidentified reward/), expect.stringMatching(/name is missing/),
    ]))
    expect(recommendFates(offered.slice(1), [], currency)).toMatchObject({ status: 'insufficient', recommendedCardIds: [] })
  })

  it('does not require a known tier for a distinct Fate or treat known non-target icons as uncertainty', () => {
    const offered = [fate('a', [reward(), combo(3)], { tier: null }), fate('b', [reward('Armour')])]
    expect(recommendFates(offered, [], currency)).toMatchObject({ status: 'ready', recommendedCardIds: ['a'] })
  })
})

describe('invocation planning', () => {
  it('compares both orders of a same-name Tier 2 pair and discards the second Fate’s rewards', () => {
    const result = planInvocation([
      fate('first', [reward('Currency', 2)], { name: '  Torchbearer ' }),
      fate('second', [reward()], { name: 'torchbearer' }),
    ], currency)

    expect(result).toMatchObject({ status: 'ready', plans: [
      { cardIds: ['first', 'second'], targetCount: 6, threshold: null, activated: false,
        merges: [{ firstId: 'first', consumedId: 'second', outputTier: 3 }] },
      { cardIds: ['second', 'first'], targetCount: 3, merges: [{ firstId: 'second', consumedId: 'first', outputTier: 3 }] },
      { cardIds: ['first'], targetCount: 2, merges: [] },
    ] })
  })

  it('evaluates distinct subsets once and prefers fewer inputs at the same score', () => {
    const result = planInvocation([
      fate('first', [reward()]), fate('irrelevant', [reward('Armour')]), fate('second', [reward()]),
    ], currency)

    expect(result.plans.map(plan => [plan.cardIds, plan.targetCount])).toEqual([
      [['first', 'second'], 2], [['first', 'irrelevant', 'second'], 2], [['first'], 1],
    ])
  })

  it('keeps two input slots assigned to a merged pair', () => {
    const cards = [fate('first', [reward('Currency', 3)], { name: 'Rot' }), fate('second', [reward()], { name: 'Rot' }),
      fate('third', [reward('Currency', 2)]), fate('fourth', [reward('Currency', 2)])]
    const result = planInvocation(cards, currency)

    expect(result.plans[0]).toMatchObject({ cardIds: ['first', 'second', 'third'], targetCount: 11 })
    expect(result.plans.every(plan => plan.cardIds.length <= 3)).toBe(true)
  })

  it.each([null, 1, 3])('leaves a same-name pair with second tier %s unresolved', (tier) => {
    const result = planInvocation([fate('a', [reward()], { name: 'Rot' }), fate('b', [reward()], { name: 'Rot', tier })], currency)

    expect(result.status).toBe('provisional')
    expect(result.plans.every(plan => plan.cardIds.length === 1 && plan.targetCount === 1)).toBe(true)
    expect(result.warnings).toContainEqual(expect.stringMatching(/confirmed merge/))
  })

  it('scores verified pairs but does not extrapolate to three copies', () => {
    const cards = ['a', 'b', 'c'].map(id => fate(id, [reward()], { name: 'Rot' }))
    const result = planInvocation(cards, currency)

    expect(result.status).toBe('provisional')
    expect(result.plans.every(plan => plan.cardIds.length === 2 && plan.targetCount === 3)).toBe(true)
    expect(result.warnings).toContainEqual(expect.stringMatching(/three copies/))
  })

  it('uses a named or unnamed single Fate’s observed rewards without assuming an unknown pair is distinct', () => {
    const result = planInvocation([fate('a', [reward()]), fate('b', [reward('Currency', 2)], { name: '' })], currency)

    expect(result.status).toBe('provisional')
    expect(result.plans[0]).toMatchObject({ cardIds: ['b'], targetCount: 2 })
    expect(result.plans[0].warnings).toContainEqual(expect.stringMatching(/name is missing/))
  })
})

describe('combo goals', () => {
  it('reports progress and activation from distinct Fates using the known threshold', () => {
    const a = fate('a', [combo()])
    const b = fate('b', [combo()])
    const c = fate('c', [combo()])
    expect(planInvocation([a], gem)).toMatchObject({ status: 'ready', plans: [{ targetCount: 1, threshold: 3, activated: false }] })
    expect(planInvocation([a, b, c], gem).plans[0]).toMatchObject({ targetCount: 3, threshold: 3, activated: true })
    expect(recommendFates([a, fate('other', [reward('Armour')])], [b, c], gem)).toMatchObject({
      status: 'ready', recommendedCardIds: ['a'],
      candidates: [{ plan: { activated: true, targetCount: 3 } }, { plan: { activated: false, targetCount: 2 } }],
    })
  })

  it('ties plans at threshold even when one has more icons', () => {
    const result = recommendFates([fate('a', [combo(6)]), fate('b', [combo(3)])], [], gem)

    expect(result.recommendedCardIds).toEqual(['a', 'b'])
    expect(result.candidates.map(candidate => candidate.plan?.targetCount)).toEqual([6, 3])
  })

  it('recognizes an explicit threshold for a combo beyond the known catalog', () => {
    const goal = { kind: 'combo', label: 'Custom' } as const
    const result = planInvocation([fate('a', [combo(1, null, goal.label)]), fate('b', [combo(1, 2, goal.label)])], goal)

    expect(result).toMatchObject({ status: 'ready', plans: [{ activated: true, threshold: 2, targetCount: 2 }, {}, {}] })
  })

  it('shows observed progress while leaving missing and conflicting thresholds unresolved', () => {
    const missing = { kind: 'combo', label: 'Custom' } as const
    expect(planInvocation([fate('a', [combo(4, null, missing.label)])], missing)).toMatchObject({
      status: 'provisional', plans: [{ targetCount: 4, threshold: null, activated: false }],
    })
    expect(recommendFates([fate('a', [combo(4, 2, missing.label)]), fate('b', [combo(1, 3, missing.label)])], [], missing)).toMatchObject({
      status: 'provisional', candidates: [{ plan: { threshold: null, activated: false } }, { plan: { threshold: null, activated: false } }],
      warnings: expect.arrayContaining([expect.stringMatching(/Conflicting thresholds/)]),
    })
    expect(planInvocation([fate('a', [combo(4, 2)])], gem)).toMatchObject({
      status: 'provisional', plans: [{ targetCount: 4, threshold: null, activated: false }],
    })
  })

  it('does not add or multiply combo icons from duplicate Fates', () => {
    const result = planInvocation([fate('a', [combo()], { name: 'Rot' }), fate('b', [combo(2)], { name: 'Rot' })], gem)

    expect(result.status).toBe('provisional')
    expect(result.plans.every(plan => plan.cardIds.length === 1 && !plan.activated)).toBe(true)
    expect(result.plans[0].targetCount).toBe(2)
    expect(result.warnings).toContainEqual(expect.stringMatching(/Combo behavior after merging/))
  })
})

describe('advisor input validation', () => {
  it('allows each pool limit and rejects exceeding either limit', () => {
    const collected = Array.from({ length: MAX_COLLECTED_FATES }, (_, index) => fate(`collected-${index}`, [reward()]))
    const offered = Array.from({ length: MAX_OFFERED_FATES }, (_, index) => fate(`offered-${index}`, [reward('Currency', 2)]))

    expect(recommendFates(offered, collected, currency).recommendedCardIds).toHaveLength(MAX_OFFERED_FATES)
    expect(planInvocation([...collected, fate('extra', [reward()])], currency)).toMatchObject({ status: 'insufficient', plans: [] })
    expect(recommendFates([...offered, fate('extra', [reward()])], collected, currency)).toMatchObject({ status: 'insufficient', candidates: [] })
  })

  it.each([
    fate('a', [reward('Currency', 0)]), fate('a', [reward('Currency', Number.NaN)]),
    fate('a', [combo(1, 1.5)]), fate('a', [reward()], { tier: Infinity }),
    fate('a', [reward(), reward()]),
  ])('rejects invalid card data without throwing (%j)', (card) => {
    expect(planInvocation([card], currency)).toMatchObject({ status: 'insufficient', plans: [] })
    expect(recommendFates([card], [], currency)).toMatchObject({ status: 'insufficient', recommendedCardIds: [] })
  })

  it('rejects duplicated card IDs or a blank goal', () => {
    const card = fate('a', [reward()])
    expect(recommendFates([card, card], [], currency)).toMatchObject({ status: 'insufficient', candidates: [] })
    expect(planInvocation([card], { kind: 'regular', label: '\t' })).toMatchObject({ status: 'insufficient', plans: [] })
  })
})
