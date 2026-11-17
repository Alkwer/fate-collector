import { expect, test } from 'vitest'
import { planInvocation, recommendFates } from '../shared/advisor'
import { recommendPortfolio, solveInvocation, visceraFactors, type SolverProfile } from '../shared/solver'
import type { FateCard, Reward } from '../shared/schema'
import { newSolverSettings, parseSolverSettings, serializeSolverSettings } from '../src/lib/solver-settings'

const regular = (count = 1): Reward => ({ id: 'currency', label: 'Currency', kind: 'regular', count, threshold: null, identified: true })
const combo = (count = 1): Reward => ({ id: 'gem', label: 'Exceptional Gem', kind: 'combo', count, threshold: 3, identified: true })
const fate = (id: string, rewards = [regular()], fields: Partial<FateCard> = {}): FateCard => ({ id, name: id, tier: 2, modifiers: ['More monster life'], rewards, ...fields })
const profile: SolverProfile = { goals: [{ kind: 'regular', label: 'Currency', weight: 1 }, { kind: 'combo', label: 'Exceptional Gem', weight: 10 }], avoidModifiers: [] }
const farming: SolverProfile = { ...profile, objective: 'viscera' }

test('collecting a partial combo remains useful but consuming it alone has no active reward', () => {
  const card = fate('gem', [combo()])
  expect(recommendPortfolio([card], [], profile).recommendedCardIds).toEqual(['gem'])
  expect(recommendFates([card], [], { kind: 'combo', label: 'Exceptional Gem' }).recommendedCardIds).toEqual(['gem'])
  expect(solveInvocation([card], profile)).toMatchObject({ status: 'insufficient', plans: [], collectingPlans: [{ score: 0 }] })
  expect(planInvocation([card], { kind: 'combo', label: 'Exceptional Gem' })).toMatchObject({ status: 'insufficient', plans: [] })
})

test('invocation does not consume an extra card just to improve an incomplete combo', () => {
  const cards = [fate('pay'), fate('partial', [combo()])]
  expect(solveInvocation(cards, profile).plans[0].cardIds).toEqual(['pay'])
  const complete = fate('complete', [combo(3)])
  expect(solveInvocation([...cards, complete], profile).plans[0].score).toBe(11)
})

test('risk exclusion and literal filters apply to both advice engines', () => {
  const danger = fate('bad', [regular(30)], { modifiers: ['Inflicts Bleeding on Hit'] })
  const okay = fate('okay')
  const filters: SolverProfile = { ...profile, risks: { bleeding: 'exclude' } }
  expect(recommendPortfolio([danger, okay], [], filters).recommendedCardIds).toEqual(['okay'])
  expect(recommendFates([danger, okay], [], { kind: 'regular', label: 'Currency' }, filters)).toMatchObject({ recommendedCardIds: ['okay'], excluded: [{ cardId: 'bad' }] })
  expect(planInvocation([danger], { kind: 'regular', label: 'Currency' }, { avoidModifiers: ['bleeding'] }).plans).toEqual([])
})

test('warn is visible without exclusion and missing effects never imply safety', () => {
  const danger = fate('bad', [regular(30)], { modifiers: ['Inflicts Bleeding on Hit'] })
  const filters: SolverProfile = { ...profile, risks: { bleeding: 'warn' } }
  expect(recommendPortfolio([danger], [], filters)).toMatchObject({ status: 'provisional', recommendedCardIds: ['bad'], excluded: [] })
  expect(planInvocation([fate('unknown', [regular()], { modifiers: [], tier: null })], { kind: 'regular', label: 'Currency' }, filters)).toMatchObject({ status: 'provisional', warnings: expect.arrayContaining([expect.stringMatching(/unverified/)]) })
})

test('a T2 pair can be excluded for its resulting T3 reference without excluding each T2', () => {
  const cards = [fate('a', [regular(2)], { name: 'Sanguine' }), fate('b', [regular()], { name: 'Sanguine' })]
  const filters: SolverProfile = { ...profile, risks: { bossRecovery: 'exclude' } }
  const result = solveInvocation(cards, filters)
  expect(result.excluded).toEqual([])
  expect(result.plans[0].score).toBe(2)
  expect(result.plans.every(plan => !plan.merges.length)).toBe(true)
  expect(planInvocation(cards, { kind: 'regular', label: 'Currency' }, filters).plans.every(plan => !plan.merges.length)).toBe(true)
})

test('Viscera uses unweighted cards and more inputs while reward mode prefers fewer', () => {
  const cards = [fate('a'), fate('b', []), fate('c', [])]
  expect(solveInvocation(cards, profile).plans[0].cardIds).toEqual(['a'])
  const result = solveInvocation(cards, { ...farming, goals: [] })
  expect(result.status).toBe('provisional')
  expect(visceraFactors(result.plans[0])).toEqual({ inputs: 3, duplicate: false })
  expect(result.plans[0].score).toBe(0)
})

test('Viscera recognizes duplicates, leaves combo scaling unknown and never supplies drop odds', () => {
  const cards = [fate('a', [combo()], { name: 'Rot' }), fate('b', [], { name: 'Rot' }), fate('c')]
  const result = solveInvocation(cards, farming)
  expect(result.plans.every(plan => visceraFactors(plan).duplicate && plan.cardIds.length === 3)).toBe(true)
  expect(result.warnings).toContainEqual(expect.stringMatching(/Drop chances/))
  expect(result.plans.some(plan => plan.rewards.some(reward => reward.kind === 'combo' && reward.count === null))).toBe(true)
})

test('Viscera offer comparison can improve farm factors without adding priority points', () => {
  const result = recommendPortfolio([fate('extra', [])], [fate('owned')], farming)
  expect(result.recommendedCardIds).toEqual(['extra'])
  expect(result.candidates[0].gain).toBe(0)
  expect(result.status).toBe('provisional')
  expect(recommendPortfolio([fate('excluded')], [], { ...farming, risks: { chaos: 'exclude' } }, ['excluded']).recommendedCardIds).toEqual([])
})

test('legacy profiles preserve preferences; new objective and risks round-trip with validation', () => {
  const legacy = newSolverSettings()
  expect(parseSolverSettings(serializeSolverSettings(legacy))).toEqual(legacy)
  const settings = { ...legacy, profile: { ...farming, risks: { chaos: 'exclude' as const } } }
  expect(parseSolverSettings(serializeSolverSettings(settings))).toEqual(settings)
  expect(() => parseSolverSettings(JSON.stringify({ ...settings, profile: { ...farming, risks: { chaos: 'maybe' } } }))).toThrow()
})

test('Viscera deltas agree with the displayed farming baseline', () => {
  const collected = ['A', 'B', 'C'].map(name => fate(name, [regular(10)]))
  collected.push(fate('d1', [], { name: 'D' }), fate('d2', [], { name: 'D' }))
  const result = recommendPortfolio([fate('b2', [regular(10)], { name: 'B' })], collected, farming)
  expect(result.baseline?.score).toBe(10)
  expect(result.candidates[0].plan?.score).toBe(40)
  expect(result.candidates[0].gain).toBe(30)
  expect(result.candidates[0].progressGain).toBe((result.candidates[0].plan?.progress ?? 0) - (result.baseline?.progress ?? 0))
})

test('missing merge references and unknown triple output stay visible under build rules', () => {
  const cards = [fate('a', [regular(5)], { name: 'Unknown' }), fate('b', [regular(3)], { name: 'Unknown' }), fate('c', [regular()], { name: 'Unknown' })]
  const filters: SolverProfile = { ...profile, risks: { bleeding: 'exclude' } }
  expect(solveInvocation(cards.slice(0, 2), filters).plans[0].warnings).toContainEqual(expect.stringMatching(/Merged Fate risk is unverified/))
  expect(solveInvocation(cards, filters).plans[0].warnings).toContainEqual(expect.stringMatching(/Three-copy output tier/))
  expect(planInvocation(cards, { kind: 'regular', label: 'Currency' }, filters).plans[0].warnings).toContainEqual(expect.stringMatching(/Three-copy output tier/))
})

test('invalid modifier data abstains instead of crashing with active filters', () => {
  const card = fate('bad', [regular()], { modifiers: null as unknown as string[] })
  expect(planInvocation([card], { kind: 'regular', label: 'Currency' }, { risks: { chaos: 'exclude' } }).status).toBe('insufficient')
})
