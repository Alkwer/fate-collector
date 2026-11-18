import { describe, expect, it } from 'vitest'
import { MAX_COLLECTED_FATES, MAX_OFFERED_FATES, planInvocation, recommendFates } from '../shared/advisor'
import type { FateCard, Reward } from '../shared/schema'
import { recommendPortfolio, solveInvocation, solverProfileSchema, type SolverProfile } from '../shared/solver'

function reward(label: string, count = 1, fields: Partial<Reward> = {}): Reward {
  return { id: label, label, count, kind: 'regular', threshold: null, identified: true, ...fields }
}

function combo(label: string, count: number, threshold: number | null = null): Reward {
  return reward(label, count, { kind: 'combo', threshold })
}

function fate(id: string, rewards: Reward[], fields: Partial<FateCard> = {}): FateCard {
  return { id, name: id, tier: 2, modifiers: [], rewards, ...fields }
}

const currency = { kind: 'regular', label: 'Currency', weight: 1 } as const
const armour = { kind: 'regular', label: 'Armour', weight: 1 } as const
const gem = { kind: 'combo', label: 'Exceptional Gem', weight: 8 } as const
const currencyProfile: SolverProfile = { goals: [currency], avoidModifiers: [] }

describe('Armoury Black Frost invocation preview', () => {
  const goal = { kind: 'combo', label: 'Additional Valuable Currency Items', weight: 6 } as const
  const profile = { goals: [goal], avoidModifiers: [] }
  const icon = combo(goal.label, 1, 3)
  const blackFrost = (id: string, rewards: Reward[]) => fate(id, rewards, { name: 'Black Frost' })
  const first = blackFrost('first', [reward('Belt'), icon])
  const middle = blackFrost('middle', [reward('Gloves'), reward('Amulet')])
  const third = blackFrost('third', [reward('Wand'), icon])

  it('recommends the duplicate over one matching icon and retains the Currency card in either collection order', () => {
    const ordinary = fate('ordinary', [icon])
    for (const [owned, offered] of [[first, middle], [middle, first]]) {
      const choices = [ordinary, offered]
      const plan = { cardIds: ['first', 'middle'], duplicateCurrency: [{ label: goal.label, count: 3, threshold: 3 }] }
      expect(recommendFates(choices, [owned], goal)).toMatchObject({
        recommendedCardIds: [offered.id], status: 'ready', candidates: [
          { plan: { ...plan, targetCount: 3, activated: true } }, {},
        ],
      })
      expect(recommendPortfolio(choices, [owned], profile)).toMatchObject({
        recommendedCardIds: [offered.id], status: 'ready', candidates: [
          { gain: 6, plan: { ...plan, score: 6 } }, {},
        ],
      })
    }
    expect(solveInvocation([first], profile).plans).toEqual([])
    expect(planInvocation([first], goal).plans).toEqual([])
    expect(solveInvocation([first, middle], profile).plans[0].rewards).toEqual([
      expect.objectContaining({ label: 'Belt', count: 3 }),
      expect.objectContaining({ label: goal.label, count: 3, threshold: 3, activated: true, uncertain: false }),
    ])
  })

  it('shows two full sets on the retained cards and awards the combo weight once', () => {
    const cards = [first, middle, third]
    const weighted = { ...profile, goals: [...profile.goals, { ...armour, label: 'Belt' }, { ...armour, label: 'Wand' }] }
    expect(solveInvocation(cards, weighted).plans[0]).toMatchObject({
      cardIds: ['first', 'middle', 'third'], discardedCardIds: ['middle'], duplicateCurrency: [{ label: goal.label, count: 6, threshold: 3 }], score: 12,
      rewards: [{ label: 'Belt', count: 3 }, { label: goal.label, count: 6, threshold: 3, points: 6 }, { label: 'Wand', count: 3 }],
    })
    // With only the combo weighted, a pair already earns all supported points.
    expect(solveInvocation(cards, profile).plans[0].cardIds).toHaveLength(2)
    expect(planInvocation(cards, goal).plans[0]).toMatchObject({ targetCount: 3, duplicateCurrency: [{ count: 3 }] })
    expect(recommendFates([third], [first, middle], goal).recommendedCardIds).toEqual([])
    expect(recommendPortfolio([third], [first, middle], profile).recommendedCardIds).toEqual([])
  })

  it('compares a future duplicate against the other choices and the collection under that same condition', () => {
    const trade = { ...profile, goals: [goal, { ...armour, label: 'Belt' }] }
    const competitor = fate('other', [reward('Belt', 4)])
    const offer = recommendPortfolio([first, competitor], [], trade)
    expect(offer.recommendedCardIds).toEqual(['other'])
    expect(offer.candidates.find(row => row.cardId === 'first')).toMatchObject({
      plan: { score: 1 }, opportunities: [{ duplicateName: 'Black Frost', icons: 1, points: 9 }, { icons: 2, points: 7 }],
    })
    const rival = blackFrost('rival', [reward('Belt', 3)])
    for (const result of [recommendPortfolio([first, rival], [], trade), recommendPortfolio([first], [rival], trade)]) {
      const candidate = result.candidates.find(row => row.cardId === 'first')!
      expect(candidate.opportunities ?? []).not.toContainEqual(expect.objectContaining({ duplicateName: 'Black Frost' }))
    }
  })

  it.each([
    { name: '' }, { tier: 1 }, { tier: 3 }, { tier: null },
    { visualReview: { version: 'test', tierReviewed: false, rewardsReviewed: true } },
    { visualReview: { version: 'test', tierReviewed: true, rewardsReviewed: false } },
    { rewards: [{ ...icon, identified: false }] }, { rewards: [{ ...icon, threshold: 2 }] },
    { rewards: [{ ...icon, label: 'Additional Currency Items', threshold: 2 }] },
    { rewards: [{ ...icon, kind: 'unknown' as const }] }, { rewards: [{ ...icon, count: 2 }] },
    { rewards: [icon, { ...icon, id: 'another' }] },
  ])('keeps unsupported or unreviewed inputs from completing this combo (%j)', fields => {
    const cards = [{ ...first, ...fields }, { ...middle, name: fields.name ?? middle.name, tier: fields.tier ?? middle.tier }]
    expect(planInvocation(cards, goal).plans).toEqual([])
    expect(solveInvocation(cards, profile).plans).toEqual([])
  })
})

it('completes both identified Currency variants on matching T2 Conjurers and keeps their thresholds separate', () => {
  const small = { kind: 'combo', label: 'Additional Currency Items', weight: 4 } as const
  const valuable = { ...small, label: 'Additional Valuable Currency Items', weight: 6 }
  const profile = { goals: [small, valuable], avoidModifiers: [] }
  const kept = fate('kept', [combo(small.label, 1, 2), combo(valuable.label, 1, 3)], { name: 'Conjurer' })
  const copy = fate('copy', [reward('Gloves')], { name: ' CONJURER ' })
  const other = { ...copy, id: 'other', name: 'Rot' }
  expect(recommendFates([copy, other], [kept], small).recommendedCardIds).toEqual(['copy'])
  expect(recommendPortfolio([copy, other], [kept], profile).recommendedCardIds).toEqual(['copy'])
  expect(solveInvocation([kept, other], profile).plans).toEqual([])
  expect(solveInvocation([copy, kept], profile).plans[0]).toMatchObject({
    cardIds: ['kept', 'copy'], score: 10, duplicateCurrency: [
      { label: small.label, threshold: 2, count: 3 }, { label: valuable.label, threshold: 3, count: 3 },
    ],
  })
})

it('compares each future duplicate name separately against the same possible Fate for every choice', () => {
  const label = 'Additional Valuable Currency Items'
  const profile = { goals: [{ kind: 'combo' as const, label, weight: 6 }, armour], avoidModifiers: [] }
  const lead = fate('Rot', [reward('Armour', 4)])
  const offers = [lead, fate('Conjurer', [combo(label, 1)]), fate('Dryad', [combo(label, 1)])]
  const result = recommendPortfolio(offers, [], profile)
  expect(result.recommendedCardIds).toEqual(['Rot'])
  for (const id of ['Conjurer', 'Dryad']) {
    expect(result.candidates.find(candidate => candidate.cardId === id)?.opportunities)
      .toEqual([{ label, duplicateName: id, icons: 1, points: 6 }])
  }
})

describe('conditional offer points', () => {
  const goals = [currency, { kind: 'combo' as const, label: 'Decks', weight: 4 }]
  const leader = fate('leader', [reward('Currency', 4)])
  const partial = fate('partial', [reward('Currency'), combo('Decks', 1, 2)])
  it('explains a strict lead after the same future icon and keeps current ranking unchanged', () => {
    const offer = recommendPortfolio([leader, partial], [], { goals, avoidModifiers: [] })
    expect(offer.recommendedCardIds).toEqual(['leader'])
    expect(offer.candidates[1]).toMatchObject({ plan: { score: 1 }, opportunities: [{ label: 'Decks', icons: 1, points: 5 }] })
  })
  it('rejects a future shared benefit, a tie, conflicting thresholds and excluded offers', () => {
    const run = (other: FateCard) => recommendPortfolio([other, partial], [], { goals, avoidModifiers: [] })
    expect(run(fate('other', [reward('Currency', 2), combo('Decks', 1, 2)])).candidates[1].opportunities).toEqual([])
    expect(run(fate('other', [reward('Currency', 5)])).candidates[1].opportunities).toEqual([])
    expect(run(fate('other', [reward('Currency', 4), combo('Decks', 1, 3)])).candidates[1].opportunities).toEqual([])
    expect(recommendPortfolio([leader, partial], [], { goals, avoidModifiers: [] }, ['partial']).candidates).toHaveLength(1)
  })
  it('requires a spare invocation input for each future Fate and keeps the old collection as an alternative', () => {
    const spare = fate('spare', [reward('Currency', 2)])
    const second = fate('second', [reward('Currency', 2)])
    const ambitious = fate('ambitious', [reward('Currency'), combo('Decks', 1, 3)])
    const run = recommendPortfolio([leader, ambitious], [spare, second], { goals, avoidModifiers: [] })
    expect(run.candidates.find(row => row.cardId === 'ambitious')?.opportunities).toEqual([])
    expect(recommendPortfolio([partial], [leader, fate('reserve', [reward('Currency', 2), combo('Decks', 1, 2)])], { goals, avoidModifiers: [] }).candidates[0].opportunities ?? []).toEqual([])
  })
  it('lets the competing choice ignore a surplus future Fate to retain a higher-scoring input', () => {
    const alternative = fate('alternative', [reward('Currency', 4), combo('Set', 1, 3)])
    const choices = [fate('current leader', [reward('Currency', 5)]), alternative, fate('two icons', [combo('Set', 2, 3)])]
    const offer = recommendPortfolio(choices, [fate('held', [reward('Currency', 5)])], {
      avoidModifiers: [], goals: [currency, { kind: 'combo', label: 'Set', weight: 7 }],
    })
    expect(offer.candidates.find(row => row.cardId === 'alternative')?.opportunities).toEqual([])
  })
})

describe('weighted invocation search', () => {
  it('abstains without positive progress, omits neutral alternatives, and keeps useful merge enablers', () => {
    const neutral = fate('neutral', [reward('Armour')], { name: 'Rot' })
    expect(solveInvocation([neutral], currencyProfile)).toMatchObject({ status: 'insufficient', plans: [], tiedBestPlanCount: 0 })
    const unknown = fate('unknown', [reward('Unread', 1, { kind: 'unknown', identified: false })])
    expect(solveInvocation([unknown], currencyProfile)).toMatchObject({ status: 'insufficient', plans: [], tiedBestPlanCount: 0,
      warnings: expect.arrayContaining([expect.stringMatching(/unidentified/)]) })
    const useful = fate('useful', [reward('Currency', 2)], { name: 'Rot' })
    const merged = solveInvocation([neutral, useful], currencyProfile)
    expect(merged.plans.map(plan => plan.score)).toEqual([6, 2])
    expect(merged.plans[0]).toMatchObject({ cardIds: ['useful', 'neutral'], discardedCardIds: ['neutral'] })
    expect(solveInvocation([fate('partial', [combo(gem.label, 1)])], { goals: [gem], avoidModifiers: [] })).toMatchObject({
      status: 'insufficient', plans: [], collectingPlans: [{ score: 0, progress: expect.closeTo(8 / 3) }],
    })
  })
  it('finds the compromise outside the top three single-goal plans', () => {
    const specialists = Array.from({ length: 4 }, (_, i) => [
      fate(`currency-${i}`, [reward('Currency', 12), reward('Armour')]),
      fate(`armour-${i}`, [reward('Currency'), reward('Armour', 12)]),
    ]).flat()
    const balanced = Array.from({ length: 3 }, (_, i) => fate(`balanced-${i}`, [reward('Currency', 8), reward('Armour', 8)]))
    const cards = [...specialists, ...balanced]

    for (const goal of [currency, armour]) {
      expect(planInvocation(cards, goal).plans.flatMap(plan => plan.cardIds).every(id => !id.startsWith('balanced'))).toBe(true)
    }
    expect(solveInvocation(cards, { goals: [currency, armour], avoidModifiers: [] })).toMatchObject({
      status: 'ready', tiedBestPlanCount: 1, plans: [{ cardIds: balanced.map(card => card.id), score: 48 }, {}, {}],
    })
  })

  it('awards a confirmed combo once and uses partial combo progress only to break payout ties', () => {
    const cards = [fate('a', [reward('Currency', 2), combo(gem.label, 2)]), fate('b', [combo(gem.label, 4)])]
    const profile = { goals: [currency, gem], avoidModifiers: [] }
    const result = solveInvocation(cards, profile)
    expect(result.plans).toMatchObject([
      { cardIds: ['a', 'b'], score: 10, progress: 8, rewards: [
        { label: 'Currency', count: 2, points: 2, activated: false },
        { label: gem.label, count: 6, threshold: 3, points: 8, activated: true },
      ] },
      { cardIds: ['b'], score: 8, progress: 8 },
      { cardIds: ['a'], score: 2, progress: expect.closeTo(16 / 3), rewards: [
        { label: 'Currency' }, { label: gem.label, count: 2, points: 0, activated: false, uncertain: false },
      ] },
    ])
    expect(recommendPortfolio([fate('currency', [reward('Currency')]), fate('partial', [combo(gem.label, 2)])], [], profile))
      .toMatchObject({ comparison: 'improvement', recommendedCardIds: ['currency'] })
  })

  it('reports all best-plan ties even with a bounded display and prefers fewer inputs on equal outcomes', () => {
    const cards = Array.from({ length: 5 }, (_, i) => fate(`fate-${i}`, [combo(gem.label, 3 + i)]))
    const result = solveInvocation(cards, { goals: [gem], avoidModifiers: [] })
    expect(result).toMatchObject({ status: 'ready', tiedBestPlanCount: 5 })
    expect(result.plans.map(plan => plan.cardIds)).toEqual([['fate-0'], ['fate-1'], ['fate-2']])
  })

  it('shows both merge orders, active cards, discarded cards, and unweighted known rewards', () => {
    const first = fate('first', [reward('Currency', 4), reward('Maps', 2)], { name: '  Torchbearer ' })
    const second = fate('second', [reward('Armour', 3)], { name: 'TORCHBEARER' })
    const third = fate('third', [reward('Currency'), reward('Divination Cards', 2)])
    const result = solveInvocation([first, second, third], { goals: [currency, armour], avoidModifiers: [] })
    expect(result.status).toBe('ready')
    expect(result.plans[0]).toMatchObject({
      cardIds: ['first', 'second', 'third'], score: 13,
      merges: [{ firstId: 'first', consumedId: 'second', outputTier: 3 }],
      retained: [{ cardId: 'first', multiplier: 3 }, { cardId: 'third', multiplier: 1 }], discardedCardIds: ['second'],
      rewards: [
        { label: 'Currency', count: 13, weight: 1, points: 13 },
        { label: 'Maps', count: 6, weight: 0, points: 0 },
        { label: 'Divination Cards', count: 2, weight: 0, points: 0 },
      ],
    })
    expect(result.plans[2]).toMatchObject({
      cardIds: ['second', 'first', 'third'], score: 10, discardedCardIds: ['first'],
      rewards: [{ label: 'Armour', count: 9 }, { label: 'Currency', count: 1 }, { label: 'Divination Cards', count: 2 }],
    })
    expect(result.plans[0]).not.toHaveProperty('triples')
  })

  it('keeps duplicate combo counts unresolved, including matching contributions from a third card', () => {
    const first = fate('first', [reward('Currency', 10), combo(gem.label, 2)], { name: 'Rot' })
    const second = fate('second', [reward('Armour'), combo('Item Rarity', 3)], { name: 'Rot' })
    const third = fate('third', [reward('Currency'), combo(gem.label, 1)])
    const result = solveInvocation([first, second, third], { goals: [currency, gem], avoidModifiers: [] })

    expect(result).toMatchObject({ status: 'provisional', warnings: expect.arrayContaining([expect.stringMatching(/Combo behavior after merging/)]) })
    expect(result.plans[0]).toMatchObject({
      cardIds: ['first', 'second', 'third'], score: 31, progress: 0,
      rewards: [{ label: 'Currency', count: 31 }, { label: gem.label, count: null, threshold: 3, activated: false, uncertain: true, points: 0 }],
    })
    expect(solveInvocation([first, second], currencyProfile)).toMatchObject({ status: 'ready', plans: [
      { score: 30, warnings: expect.arrayContaining([expect.stringMatching(/Combo behavior after merging/)]) }, {},
    ] })
  })

  it.each([
    { tier: 3 }, { tier: 1 }, { tier: null }, { visualReview: { version: 'matcher', tierReviewed: false, rewardsReviewed: true } },
  ])('leaves an unsupported duplicate pair unresolved (%j)', fields => {
    const cards = [fate('a', [reward('Currency', 2)], { name: 'Rot' }), fate('b', [reward('Currency')], { name: 'Rot', ...fields })]
    const result = solveInvocation(cards, currencyProfile)
    expect(result.status).toBe('provisional')
    expect(result.plans.every(plan => plan.cardIds.length === 1 && plan.merges.length === 0)).toBe(true)
  })

  it('triples both retained reward rows and chooses the middle Fate using weighted priorities', () => {
    const cards = [
      fate('first', [reward('Currency', 4), reward('Maps', 2)], { name: '  Torchbearer ' }),
      fate('second', [reward('Armour', 3), reward('Divination Cards')], { name: 'TORCHBEARER' }),
      fate('third', [reward('Currency'), reward('Armour', 4)], { name: 'torchbearer' }),
    ]
    const result = solveInvocation(cards, { goals: [currency, { ...armour, weight: 2 }], avoidModifiers: [] })
    expect(result).toMatchObject({ status: 'ready', tiedBestPlanCount: 1 })
    expect(result.plans[0]).toMatchObject({
      cardIds: ['second', 'first', 'third'], score: 45, progress: 0, merges: [],
      triples: [{ firstId: 'second', consumedId: 'first', thirdId: 'third' }],
      retained: [{ cardId: 'second', multiplier: 3 }, { cardId: 'third', multiplier: 3 }], discardedCardIds: ['first'],
      rewards: [
        { label: 'Armour', count: 21, weight: 2, points: 42 },
        { label: 'Divination Cards', count: 3, weight: 0, points: 0 },
        { label: 'Currency', count: 3, weight: 1, points: 3 },
      ],
    })
  })

  it('reports tied triples by which middle Fate they discard', () => {
    const cards = ['a', 'b', 'c'].map(id => fate(id, [reward('Currency')], { name: 'Rot' }))
    const result = solveInvocation(cards, currencyProfile)
    expect(result).toMatchObject({ status: 'ready', tiedBestPlanCount: 3, warnings: [] })
    expect(result.plans.map(plan => [plan.cardIds, plan.score])).toEqual([
      [['a', 'b', 'c'], 6], [['b', 'a', 'c'], 6], [['a', 'c', 'b'], 6],
    ])
  })

  it('leaves retained triple combos unresolved and omits rewards from the middle Fate', () => {
    const cards = [
      fate('first', [reward('Currency', 8), combo(gem.label, 1)], { name: 'Rot' }),
      fate('middle', [reward('Armour'), combo('Item Rarity', 3)], { name: 'Rot' }),
      fate('third', [reward('Currency', 3), combo(gem.label, 2)], { name: 'Rot' }),
    ]
    const result = solveInvocation(cards, { goals: [currency, gem], avoidModifiers: [] })
    expect(result.status).toBe('provisional')
    expect(result.plans[0]).toMatchObject({
      cardIds: ['first', 'middle', 'third'], score: 33, progress: 0,
      rewards: [
        { label: 'Currency', count: 33 },
        { label: gem.label, count: null, threshold: 3, activated: false, uncertain: true, points: 0 },
      ],
      warnings: expect.arrayContaining([expect.stringMatching(/Combo behavior after invoking three copies/)]),
    })
    expect(solveInvocation(cards, currencyProfile).status).toBe('ready')
  })

  it.each([1, 3])('scores a reviewed same-tier triple at Tier %i while keeping pairs unresolved', tier => {
    const cards = ['a', 'b', 'c'].map(id => fate(id, [reward('Currency')], { name: 'Rot', tier }))
    const result = solveInvocation(cards, currencyProfile)
    expect(result).toMatchObject({ status: 'provisional', plans: [
      { score: 6, merges: [], triples: [{ firstId: 'a', consumedId: 'b', thirdId: 'c' }], warnings: [] }, {}, {},
    ], warnings: ['Only pairs of the same Fate at Tier 2 have a confirmed merge.'] })
  })

  it.each([
    { tier: 3 }, { tier: null },
    { visualReview: { version: 'matcher', tierReviewed: false, rewardsReviewed: true } },
  ])('continues to score verified pairs with unsupported triple tiers (%j)', fields => {
    const cards = ['a', 'b', 'c'].map((id, index) => fate(id, [reward('Currency')], { name: 'Rot', ...(index === 2 ? fields : {}) }))
    const result = solveInvocation(cards, currencyProfile)
    expect(result.status).toBe('provisional')
    expect(result.plans[0]).toMatchObject({ cardIds: ['a', 'b'], score: 3 })
    expect(result.plans.every(plan => !plan.triples)).toBe(true)
    expect(result.warnings).toContainEqual(expect.stringMatching(/three copies/))
  })
})

describe('portfolio recommendation', () => {
  it('compares one offered Fate at a time against the baseline and includes all tied winners', () => {
    const collected = ['a', 'b', 'c'].map((id, index) => fate(id, [reward('Currency', index + 1)]))
    const offered = [fate('worse', [reward('Armour')]), fate('first', [reward('Currency', 4)]), fate('second', [reward('Currency', 4)])]
    const result = recommendPortfolio(offered, collected, currencyProfile)
    expect(result).toMatchObject({
      status: 'ready', comparison: 'improvement', baseline: { score: 6, cardIds: ['a', 'b', 'c'] }, recommendedCardIds: ['first', 'second'],
      candidates: [
        { cardId: 'first', gain: 3, progressGain: 0, plan: { score: 9, cardIds: ['first', 'b', 'c'] } },
        { cardId: 'second', gain: 3, progressGain: 0, plan: { score: 9, cardIds: ['second', 'b', 'c'] } },
        { cardId: 'worse', gain: -1, progressGain: 0, plan: { score: 5, cardIds: ['worse', 'b', 'c'] } },
      ],
    })
    expect(recommendPortfolio(offered.slice(0, 1), collected, currencyProfile)).toMatchObject({
      status: 'ready', comparison: 'no-improvement', recommendedCardIds: [],
    })
  })

  it('accounts for progress without pretending an incomplete combo paid out', () => {
    const collected = [fate('owned', [combo(gem.label, 1)])]
    const offered = [fate('offered', [combo(gem.label, 1)]), fate('neutral', [reward('Armour')])]
    expect(recommendPortfolio(offered, collected, { goals: [gem], avoidModifiers: [] })).toMatchObject({
      status: 'ready', comparison: 'improvement', recommendedCardIds: ['offered'], baseline: { score: 0 },
      candidates: [{ gain: 0, progressGain: expect.closeTo(8 / 3) }, { gain: 0, progressGain: 0 }],
    })
  })

  it('detects a gain from collecting a card that enables a merge while discarding its rewards', () => {
    const collected = [fate('owned', [reward('Currency', 2)], { name: 'Rot' })]
    const offered = [fate('merge', [reward('Armour')], { name: 'ROT' })]
    expect(recommendPortfolio(offered, collected, currencyProfile)).toMatchObject({
      comparison: 'improvement', recommendedCardIds: ['merge'],
      candidates: [{ gain: 4, plan: { cardIds: ['owned', 'merge'], discardedCardIds: ['merge'] } }],
    })
  })

  it('detects the gain from an offered third copy even when it supplies no rewards to the outcome', () => {
    const collected = [
      fate('first', [reward('Currency', 5)], { name: 'Rot' }),
      fate('third', [reward('Currency', 3)], { name: 'Rot' }),
    ]
    const offered = [
      fate('other', [reward('Currency', 2)]),
      fate('middle', [reward('Armour')], { name: 'ROT' }),
    ]
    expect(recommendPortfolio(offered, collected, currencyProfile)).toMatchObject({
      status: 'ready', comparison: 'improvement', recommendedCardIds: ['middle'],
      baseline: { score: 15 },
      candidates: [
        { cardId: 'middle', gain: 9, plan: { cardIds: ['first', 'middle', 'third'], score: 24,
          discardedCardIds: ['middle'], triples: [{ firstId: 'first', consumedId: 'middle', thirdId: 'third' }] } },
        { cardId: 'other', gain: 2, plan: { cardIds: ['first', 'third', 'other'] } },
      ],
    })
  })

  it('does not split equivalent decimal scores into different ranks', () => {
    const profile = { goals: [{ ...currency, weight: 0.1 }, { ...armour, weight: 0.3 }], avoidModifiers: [] }
    const cards = [fate('a', [reward('Currency', 3)]), fate('b', [reward('Armour')])]
    expect(recommendPortfolio(cards, [], profile)).toMatchObject({ recommendedCardIds: ['a', 'b'] })
  })

  it('uses one threshold policy for baseline and offered candidates and exposes conflicts', () => {
    const goal = { ...gem, label: 'Custom Combo' }
    const collected = [fate('a', [combo(goal.label, 1, 2)])]
    const offered = [fate('b', [combo(goal.label, 1)]), fate('conflict', [combo(goal.label, 2, 3)])]
    const profile = { goals: [goal], avoidModifiers: [] }
    expect(recommendPortfolio(offered.slice(0, 1), collected, profile)).toMatchObject({
      status: 'ready', comparison: 'improvement', baseline: { rewards: [{ threshold: 2, activated: false }] },
      candidates: [{ gain: 8, plan: { rewards: [{ count: 2, threshold: 2, activated: true }] } }],
    })
    expect(recommendPortfolio(offered, collected, profile)).toMatchObject({
      status: 'provisional', comparison: 'unknown', recommendedCardIds: [],
      baseline: { rewards: [{ threshold: null, activated: false, uncertain: true }] },
      warnings: expect.arrayContaining([expect.stringMatching(/Conflicting thresholds/)]),
    })
    expect(solveInvocation([fate('a', [combo(gem.label, 2, 2)])], { goals: [gem], avoidModifiers: [] })).toMatchObject({
      status: 'insufficient', plans: [], warnings: expect.arrayContaining([expect.stringMatching(/Conflicting thresholds/)]),
    })
  })

  it('keeps missing, unidentified and partial reward data visible without a firm winner', () => {
    const cards = [fate('empty', []), fate('known', [reward('Currency', 3)], { visualReview: {
      version: 'matcher', tierReviewed: true, rewardsReviewed: false,
    } }), fate('unknown', [reward('Unread icon', 1, { identified: false, kind: 'unknown' })])]
    const result = recommendPortfolio(cards, [], currencyProfile)
    expect(result).toMatchObject({ status: 'provisional', comparison: 'unknown', recommendedCardIds: ['known'] })
    expect(result.candidates.map(candidate => candidate.plan?.rewards.filter(reward => reward.kind === 'unknown'))).toMatchObject([
      [{ label: 'Reward row not reviewed', count: null, uncertain: true }],
      [{ label: 'Unrecorded rewards', count: null, uncertain: true }],
      [{ label: 'Unread icon', count: 1, uncertain: true }],
    ])
    expect(solveInvocation([fate('unknown-threshold', [combo('Custom Combo', 3)])], {
      goals: [{ ...gem, label: 'Custom Combo' }], avoidModifiers: [],
    })).toMatchObject({ status: 'insufficient', plans: [], warnings: expect.arrayContaining([expect.stringMatching(/threshold.*unknown/)]) })
  })

  it('filters whole cards before comparison, matches literal modifier fragments and reports every exclusion reason', () => {
    const profile = { goals: [currency], avoidModifiers: ['reflect', '[Cold]', 'damage.*'] }
    const collected = [fate('owned', [reward('Currency', 100)], { modifiers: ['Monsters REFLECT damage', 'Extra [cold] damage'] })]
    const offered = [fate('literal', [reward('Currency', 2)], { modifiers: ['damage taken'] }), fate('missing', [reward('Currency')]),
      fate('blocked', [], { modifiers: ['literal Damage.*'] }), fate('also-owned', [reward('Currency')], { modifiers: ['Reflect'] })]
    const result = recommendPortfolio(offered, collected, profile, ['owned', 'also-owned', 'unused'])
    expect(result).toMatchObject({
      status: 'provisional', comparison: 'unknown', baseline: null, recommendedCardIds: ['literal'],
      excluded: [
        { cardId: 'owned', reasons: ['Excluded from planning.', 'Modifier matches “reflect”.', 'Modifier matches “[Cold]”.'] },
        { cardId: 'blocked', reasons: ['Modifier matches “damage.*”.'] },
        { cardId: 'also-owned', reasons: ['Excluded from planning.', 'Modifier matches “reflect”.'] },
      ],
      warnings: ['A Fate has no recorded modifiers. Its modifier safety is unverified.'],
    })
    expect(solveInvocation(collected, profile)).toMatchObject({ status: 'insufficient', plans: [], excluded: [{ cardId: 'owned' }] })
    expect(recommendPortfolio([collected[0]], collected, currencyProfile)).toMatchObject({
      status: 'insufficient', candidates: [], baseline: { score: 100 }, warnings: expect.arrayContaining([expect.stringMatching(/already in the collected pool/)]),
    })
  })
})

describe('solver validation', () => {
  it('normalizes labels without merging different reward kinds and accepts empty or zero-weight editing drafts', () => {
    const comboGoal = { kind: 'combo', label: '  DREADMAIDENS’\t Sacrament ', weight: 1 } as const
    const card = fate('a', [combo("Dreadmaidens' Sacrament", 2), reward("Dreadmaidens' Sacrament", 1, { id: 'ordinary' })])
    const profile = { goals: [comboGoal, { ...comboGoal, kind: 'regular' as const }], avoidModifiers: [] }
    expect(solveInvocation([card], profile)).toMatchObject({ status: 'ready', plans: [{ score: 2 }] })
    expect(solverProfileSchema.safeParse({ ...profile, goals: [...profile.goals, { ...comboGoal, label: "dreadmaidens' sacrament" }] }).success).toBe(false)
    for (const goals of [[], [{ ...comboGoal, weight: 0 }]]) {
      const draft = { ...profile, goals }
      expect(solverProfileSchema.safeParse(draft).success).toBe(true)
      expect(recommendPortfolio([card], [], draft)).toMatchObject({ status: 'insufficient', recommendedCardIds: [],
        warnings: ['Choose at least one positive reward priority.'] })
    }
  })

  it.each([
    { ...currencyProfile, extra: true },
    { ...currencyProfile, avoidModifiers: ['  '] },
    { ...currencyProfile, avoidModifiers: Array(31).fill('x') },
    { ...currencyProfile, goals: [{ ...currency, weight: -1 }] },
    { ...currencyProfile, goals: [{ ...currency, weight: 1_000_001 }] },
    { ...currencyProfile, goals: [{ ...currency, weight: Number.NaN }] },
    { ...currencyProfile, goals: [{ ...currency, weight: Infinity }] },
  ])('abstains on an invalid profile (%j)', profile => {
    expect(solveInvocation([fate('a', [reward('Currency')])], profile)).toMatchObject({ status: 'insufficient', plans: [] })
  })

  it('rejects malformed solver data without throwing', () => {
    const card = fate('a', [reward('Currency')])
    const invalid = [fate('b', [reward('Currency', NaN)]), fate('b', [combo(gem.label, 1, 1.5)]), fate('b', [reward('Currency', 1)], { tier: Infinity }),
      fate('b', [reward('Currency'), reward('Currency')]), fate('b', [], { modifiers: null as never }),
      fate('b', [], { visualReview: { version: 'matcher', tierReviewed: null as never, rewardsReviewed: true } }),
      fate('b', Array.from({ length: 31 }, (_, i) => reward(`R-${i}`))), null as never]
    for (const malformed of invalid) {
      expect(solveInvocation([card, malformed], currencyProfile)).toMatchObject({ status: 'insufficient', plans: [] })
    }
    expect(solveInvocation([card, card], currencyProfile)).toMatchObject({ status: 'insufficient', plans: [] })
    expect(solveInvocation([card], currencyProfile, ['  '])).toMatchObject({ status: 'insufficient', plans: [] })
  })

  it('supports both pool limits with finite scores, leaves inputs untouched, and rejects overflow', () => {
    const collected = Array.from({ length: MAX_COLLECTED_FATES }, (_, i) => fate(`collected-${i}`, [reward('Currency', 99)]))
    const offered = Array.from({ length: MAX_OFFERED_FATES }, (_, i) => fate(`offered-${i}`, [reward('Currency', 100)]))
    const profile = { goals: [{ ...currency, weight: 1_000_000 }], avoidModifiers: [] }
    const excluded: string[] = []
    const before = structuredClone({ collected, offered, profile, excluded })
    const result = recommendPortfolio(offered, collected, profile, excluded)
    expect(result.recommendedCardIds).toEqual(offered.map(card => card.id))
    expect(result.candidates.every(candidate => candidate.plan?.score === 298_000_000 && candidate.gain === 1_000_000)).toBe(true)
    expect({ collected, offered, profile, excluded }).toEqual(before)
    expect(solveInvocation([...collected, fate('extra', [])], profile)).toMatchObject({ status: 'insufficient', plans: [] })
    expect(recommendPortfolio([...offered, fate('extra', [])], collected, profile)).toMatchObject({ status: 'insufficient', candidates: [] })
  })
})
